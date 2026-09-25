import { DocumentManager } from "./document-manager.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AIWritingRequest, AIChunk } from "@repo/types";

export interface AIService {
  startWriting(request: AIWritingRequest): AsyncGenerator<AIChunk>;
  cancelWriting(requestId: string): void;
}

export class GeminiAIService implements AIService {
  private readonly activeStreams = new Map<string, AbortController>();
  private readonly documentManager: DocumentManager;
  private readonly genAI: GoogleGenerativeAI;

  // Concurrency tracking (rate limiting)
  private readonly docActiveRequests = new Map<string, number>();
  private readonly userActiveRequests = new Map<string, number>();

  public constructor(documentManager: DocumentManager) {
    this.documentManager = documentManager;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error(
        "[GeminiAIService] Error: GEMINI_API_KEY is not set in environment",
      );
    }
    this.genAI = new GoogleGenerativeAI(apiKey ?? "");
  }

  public cancelWriting(requestId: string): void {
    const controller = this.activeStreams.get(requestId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(requestId);
    }
  }

  public async *startWriting(
    request: AIWritingRequest,
  ): AsyncGenerator<AIChunk> {
    // 1. Rate Limiting Checks
    const docCount = this.docActiveRequests.get(request.docId) ?? 0;
    if (docCount >= 1) {
      throw new Error("RATE_LIMITED: Max 1 concurrent AI request per document");
    }

    const userCount = this.userActiveRequests.get(request.userId) ?? 0;
    if (userCount >= 3) {
      throw new Error("RATE_LIMITED: Max 3 concurrent AI requests per user");
    }

    this.docActiveRequests.set(request.docId, docCount + 1);
    this.userActiveRequests.set(request.userId, userCount + 1);

    const controller = new AbortController();
    this.activeStreams.set(request.requestId, controller);

    try {
      // 2. Get document text for context (read-only; Y.Doc is mutated client-side via Tiptap)
      const entry = await this.documentManager.getOrCreate(request.docId);
      const currentContent = entry.doc.getXmlFragment("content").toString();

      // Dev/test only: stream a canned answer so the UI can be exercised
      // without a Gemini key. Never enabled unless AI_MOCK=1 is set explicitly.
      if (process.env.AI_MOCK === "1") {
        const canned = [
          "## Mock AI draft\n\n",
          `You asked: **${request.prompt.slice(0, 80)}**.\n\n`,
          "- Point one about the note\n- Point two with a link to [[Sourdough Bread]]\n\n",
          "This text is streamed word by word by the development mock.",
        ].join("");
        for (const word of canned.match(/\S+\s*/g) ?? []) {
          if (controller.signal.aborted) break;
          await new Promise((r) => setTimeout(r, 90));
          yield {
            requestId: request.requestId,
            text: word,
            update: new Uint8Array(0),
            isDone: false,
          };
        }
        yield {
          requestId: request.requestId,
          text: "",
          update: new Uint8Array(0),
          isDone: true,
        };
        return;
      }

      // 3. Initialize Gemini model
      // gemini-2.5-flash is the primary model for this environment.
      const model = this.genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: [
          "You are a writing assistant for a Markdown-based Knowdex app.",
          "Generate ONLY the requested content in clean Markdown.",
          "Use proper Markdown: # for headings, **bold**, *italic*, - for lists, etc.",
          "Do NOT include preamble, explanations, or meta-commentary.",
          "Start directly with the content.",
        ].join(" "),
      });

      // 4. Stream from Gemini.
      // Tokens are sent as raw text to the client. The client inserts them via
      // Tiptap's Markdown extension so formatting is preserved in the Y.Doc.
      // We do NOT manipulate the Y.Doc here — that would produce unformatted
      // plain text (e.g. "## Heading" as literal characters).
      const prompt = `Current document context:\n\n${currentContent}\n\nTask: ${request.prompt}`;
      console.log(
        `[AI] Starting stream for request ${request.requestId}, prompt length: ${request.prompt.length}, context length: ${currentContent.length}`,
      );

      const result = await model.generateContentStream(prompt, {
        signal: controller.signal,
      });

      const emptyUpdate = new Uint8Array(0);

      try {
        for await (const responseChunk of result.stream) {
          if (controller.signal.aborted) {
            console.log(`[AI] Stream aborted for request ${request.requestId}`);
            break;
          }

          let token = "";
          try {
            token = responseChunk.text();
          } catch (textError) {
            console.warn(
              `[AI] Failed to get text from chunk:`,
              JSON.stringify(responseChunk, null, 2),
            );
            // If we can't get text, maybe it's a safety block or other issue
            if (
              responseChunk.candidates &&
              responseChunk.candidates[0]?.finishReason
            ) {
              console.warn(
                `[AI] Finish reason: ${responseChunk.candidates[0].finishReason}`,
              );
              if (responseChunk.candidates[0].finishReason === "SAFETY") {
                throw new Error("AI output was blocked by safety filters");
              }
            }
            continue;
          }

          if (!token) continue;

          yield {
            requestId: request.requestId,
            text: token,
            update: emptyUpdate,
            isDone: false,
          };
        }
      } catch (streamError: any) {
        // Handle "Failed to parse stream" and other SDK errors
        if (streamError?.message?.includes("Failed to parse stream")) {
          console.error(
            `[AI] Stream parsing failed. This can happen if the API returns an error without a body or is overloaded.`,
          );
          throw new Error("AI service temporarily unavailable (stream error)");
        }
        console.error(
          `[AI] Stream iteration error for request ${request.requestId}:`,
          streamError,
        );
        throw streamError;
      }

      yield {
        requestId: request.requestId,
        text: "",
        update: emptyUpdate,
        isDone: true,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        yield {
          requestId: request.requestId,
          text: "",
          update: new Uint8Array(0),
          isDone: true,
        };
      } else {
        throw error;
      }
    } finally {
      this.activeStreams.delete(request.requestId);

      const finalDocCount = this.docActiveRequests.get(request.docId) ?? 1;
      if (finalDocCount <= 1) {
        this.docActiveRequests.delete(request.docId);
      } else {
        this.docActiveRequests.set(request.docId, finalDocCount - 1);
      }

      const finalUserCount = this.userActiveRequests.get(request.userId) ?? 1;
      if (finalUserCount <= 1) {
        this.userActiveRequests.delete(request.userId);
      } else {
        this.userActiveRequests.set(request.userId, finalUserCount - 1);
      }
    }
  }
}
