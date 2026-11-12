import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

const JWT_ISSUER = "mavunotrail-api";
const JWT_AUDIENCE = "mavunotrail-app";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required."
      });
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("JWT_SECRET is missing.");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error."
      });
    }

    const decoded = jwt.verify(token, jwtSecret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    if (typeof decoded === "string") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token."
      });
    }

    const payload = decoded as JwtPayload & {
      cooperativeId?: string;
      farmerId?: string;
      role?: string;
      walletAddress?: string;
    };

if (
      typeof payload.sub !== "string" ||
      typeof payload.cooperativeId !== "string" ||
      !["manager", "staff", "farmer"].includes(payload.role || "") ||
      typeof payload.walletAddress !== "string"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token."
      });
    }

    req.user = {
  id: payload.sub,
  farmerId: payload.farmerId,
  cooperativeId: payload.cooperativeId,
  role: payload.role as "manager" | "staff" | "farmer",
  walletAddress: payload.walletAddress
};

    return next();

  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token."
    });
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required."
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource."
      });
    }

    if (req.user.role === "farmer" && !req.user.farmerId) {
      return res.status(403).json({
        success: false,
        message: "Farmer profile is not linked to this account."
      });
    }

    return next();
  };
}