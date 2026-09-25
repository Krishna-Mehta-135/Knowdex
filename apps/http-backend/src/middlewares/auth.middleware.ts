import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import jwt from "jsonwebtoken";
import { prisma, User } from "@repo/db";
import { ApiResponse } from "../utils/ApiResponse";

declare global {
  namespace Express {
    interface Request {
      user?: Omit<User, "password">;
    }
  }
}

// JWT payload interface
interface JwtPayload {
  id: string;
  iat?: number;
  exp?: number;
}

const protect = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      try {
        const token = req.headers.authorization.split(" ")[1];
        if (!token) {
          return res
            .status(401)
            .json(
              new ApiResponse(
                401,
                null,
                "Not authorized. Invalid token format.",
              ),
            );
        }
        if (!process.env.JWT_SECRET) {
          throw new Error(
            "JWT_SECRET is not defined in environment variables.",
          );
        }
        const secret = process.env.JWT_SECRET;
        const decoded = jwt.verify(token, secret!) as unknown as JwtPayload;

        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
        });

        if (!user) {
          return res
            .status(401)
            .json(new ApiResponse(401, null, "User not found"));
        }

        const { password, ...userWithoutPassword } = user;
        req.user = userWithoutPassword;

        return next();
      } catch (error: any) {
        if (error.name === "TokenExpiredError") {
          return res
            .status(401)
            .json(
              new ApiResponse(401, null, "Token expired. Please login again."),
            );
        }
        return res
          .status(401)
          .json(new ApiResponse(401, null, "Not authorized. Token failed."));
      }
    }

    return res
      .status(401)
      .json(new ApiResponse(401, null, "Not authorized. No token."));
  },
);

export { protect };
