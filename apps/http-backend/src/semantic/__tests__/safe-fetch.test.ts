import { describe, expect, it } from "vitest";
import { isPrivateIp } from "../safe-fetch.js";
import { htmlToMarkdown } from "../clip.js";

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.3.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("blocks %s", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
  ])("allows %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe("htmlToMarkdown", () => {
  it("extracts title, headings, links, lists and drops scripts", () => {
    const { title, markdown, description } = htmlToMarkdown(
      `<html><head><title>My Page</title><meta name="description" content="Desc &amp; more"></head><body>
       <script>evil()</script><nav>menu</nav>
       <article><h2>Head</h2><p>Hello <b>bold</b> and <a href="https://a.com/x">link</a></p><ul><li>one</li><li>two</li></ul></article></body></html>`,
    );
    expect(title).toBe("My Page");
    expect(description).toBe("Desc & more");
    expect(markdown).toContain("## Head");
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("[link](https://a.com/x)");
    expect(markdown).toContain("- one");
    expect(markdown).not.toContain("evil");
    expect(markdown).not.toContain("menu");
  });

  it("does not leak the <title> text into the body", () => {
    const { markdown } = htmlToMarkdown(
      "<html><head><title>Only Title</title></head><body><h1>Heading</h1><p>Text</p></body></html>",
    );
    expect(markdown).not.toContain("Only Title");
    expect(markdown).toContain("# Heading");
  });
});
