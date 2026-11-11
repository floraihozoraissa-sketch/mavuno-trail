import { Router } from "express";
import { randomBytes } from "crypto";
import { isAddress } from "ethers";
import { supabase } from "../config/supabase";
import jwt from "jsonwebtoken";
import { SiweMessage } from "siwe";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";

const CHAIN_ID = 11155111; // Ethereum Sepolia

// Generate a one-time login nonce
// Verify wallet signature and issue JWT
router.post("/verify", async (req, res) => {
  try {
    const { message, signature } = req.body;

    if (
      typeof message !== "string" ||
      typeof signature !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Message and signature are required."
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("JWT_SECRET is missing.");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error."
      });
    }

    const expectedDomain = new URL(FRONTEND_URL).host;
    const expectedOrigin = new URL(FRONTEND_URL).origin;

    // Parse the signed SIWE message
    const siweMessage = new SiweMessage(message);

    const walletAddress = siweMessage.address.toLowerCase();

    // Validate message properties
    if (
      siweMessage.domain !== expectedDomain ||
      new URL(siweMessage.uri).origin !== expectedOrigin ||
      siweMessage.chainId !== CHAIN_ID ||
      siweMessage.version !== "1"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid login message."
      });
    }

    // Find the matching nonce
    const { data: nonceRecord, error: nonceError } = await supabase
      .from("wallet_nonces")
      .select("id, nonce, expires_at, consumed_at")
      .eq("wallet_address", walletAddress)
      .eq("nonce", siweMessage.nonce)
      .maybeSingle();

    if (nonceError || !nonceRecord) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired login nonce."
      });
    }

    if (
      nonceRecord.consumed_at ||
      new Date(nonceRecord.expires_at).getTime() <= Date.now()
    ) {
      return res.status(401).json({
        success: false,
        message: "Login nonce has expired or was already used."
      });
    }

    // Verify the cryptographic signature
    const verification = await siweMessage.verify({
      signature,
      nonce: nonceRecord.nonce,
      domain: expectedDomain
    });

    if (!verification.success) {
      return res.status(401).json({
        success: false,
        message: "Wallet signature verification failed."
      });
    }

    // Confirm that this wallet belongs to an active staff account
    const { data: user, error: userError } = await supabase
      .from("app_users")
      .select("id, cooperative_id, full_name, role, wallet_address, status")
      .eq("wallet_address", walletAddress)
      .eq("status", "active")
      .maybeSingle();

    if (userError || !user || !["manager", "staff"].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "This wallet is not authorized for staff access."
      });
    }

    // Atomically consume the nonce to prevent replay
    const { data: consumedNonce, error: consumeError } = await supabase
      .from("wallet_nonces")
      .update({
        consumed_at: new Date().toISOString()
      })
      .eq("id", nonceRecord.id)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();

    if (consumeError || !consumedNonce) {
      return res.status(401).json({
        success: false,
        message: "Login nonce has expired or was already used."
      });
    }

    // Issue a short-lived access token
    const token = jwt.sign(
      {
        sub: user.id,
        cooperativeId: user.cooperative_id,
        role: user.role,
        walletAddress
      },
      jwtSecret,
      {
        expiresIn: "30m",
        issuer: "mavunotrail-api",
        audience: "mavunotrail-app"
      }
    );

    // Update last login
    await supabase
      .from("app_users")
      .update({
        last_login_at: new Date().toISOString()
      })
      .eq("id", user.id);

    return res.status(200).json({
      success: true,
      message: "Wallet authentication successful.",
      data: {
        token,
        user: {
          id: user.id,
          cooperativeId: user.cooperative_id,
          fullName: user.full_name,
          role: user.role,
          walletAddress
        }
      }
    });

  } catch (error) {
    console.error("SIWE verification error:", error);

    return res.status(401).json({
      success: false,
      message: "Could not verify wallet authentication."
    });
  }
});

router.post("/nonce", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (
      typeof walletAddress !== "string" ||
      !isAddress(walletAddress)
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid wallet address is required."
      });
    }

    const normalizedAddress = walletAddress.toLowerCase();

    // Generate a cryptographically random nonce
    const nonce = randomBytes(16).toString("hex");

    // Nonce expires after five minutes
    const expiresAt = new Date(
      Date.now() + 5 * 60 * 1000
    ).toISOString();

    const { error } = await supabase
      .from("wallet_nonces")
      .insert({
        wallet_address: normalizedAddress,
        nonce,
        expires_at: expiresAt
      });

    if (error) {
      console.error("Nonce creation failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not create login nonce."
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        nonce,
        domain: new URL(FRONTEND_URL).host,
        uri: FRONTEND_URL,
        chainId: CHAIN_ID,
        expiresAt
      }
    });

  } catch (error) {
    console.error("Nonce endpoint error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected authentication error."
    });
  }
});

// Return the identity contained in the verified JWT
router.get("/me", requireAuth, (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Authenticated user retrieved successfully.",
    data: {
      id: req.user!.id,
      cooperativeId: req.user!.cooperativeId,
      role: req.user!.role,
      walletAddress: req.user!.walletAddress
    }
  });
});

// Demo farmer authentication - clearly labeled as demonstration only
// This endpoint allows access to fictional seed farmer records for demonstration purposes
router.post("/farmer/demo", async (req, res) => {
  try {
    const { farmerCode } = req.body;

    if (typeof farmerCode !== "string" || !farmerCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "Farmer code is required for demo access."
      });
    }

    const normalizedCode = farmerCode.trim().toUpperCase();
    const permittedDemoCodes = ["F-0248", "F-0312", "F-0156", "F-0421"];

    if (!permittedDemoCodes.includes(normalizedCode)) {
      return res.status(403).json({
        success: false,
        message: "Invalid demo farmer code."
      });
    }

    const { data: farmer, error: farmerError } = await supabase
      .from("farmers")
      .select("id, cooperative_id, farmer_code, full_name, village, district, status")
      .eq("farmer_code", normalizedCode)
      .eq("status", "active")
      .maybeSingle();

    if (farmerError) {
      console.error("Farmer demo lookup failed:", farmerError.message);
      return res.status(500).json({
        success: false,
        message: "Could not retrieve farmer record."
      });
    }

    if (!farmer) {
      return res.status(404).json({
        success: false,
        message: "Demo farmer not found. Use a valid fictional farmer code."
      });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: "Authentication configuration error."
      });
    }

    // Issue a demo token with farmer role
    const token = jwt.sign(
      {
        sub: farmer.id,
        cooperativeId: farmer.cooperative_id,
        role: "farmer",
        walletAddress: "demo-farmer-" + farmer.farmer_code.toLowerCase(),
        farmerCode: farmer.farmer_code
      },
      jwtSecret,
      {
        expiresIn: "2h",
        issuer: "mavunotrail-api",
        audience: "mavunotrail-app"
      }
    );

    return res.status(200).json({
      success: true,
      message: "Demo farmer access granted. This is a demonstration using fictional records.",
      data: {
        token,
        user: {
          id: farmer.id,
          cooperativeId: farmer.cooperative_id,
          fullName: farmer.full_name,
          role: "farmer",
          walletAddress: "demo-farmer-" + farmer.farmer_code.toLowerCase(),
          farmerCode: farmer.farmer_code,
          village: farmer.village,
          district: farmer.district
        }
      }
    });

  } catch (error) {
    console.error("Farmer demo authentication error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not process demo farmer access."
    });
  }
});

export default router;