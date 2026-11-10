
import { Router } from "express";
import { supabase } from "../config/supabase";
import {
  requireAuth,
  requireRole
} from "../middleware/auth.middleware";

const router = Router();

const staffAccess = [
  requireAuth,
  requireRole("manager", "staff")
];

// GET all farmers belonging to the authenticated user's cooperative
router.get("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;

    const { data, error } = await supabase
      .from("farmers")
      .select(`
        id,
        farmer_code,
        full_name,
        phone,
        village,
        sector,
        district,
        status,
        created_at
      `)
      .eq("cooperative_id", cooperativeId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Farmers query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve farmers."
      });
    }

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Farmers API error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving farmers."
    });
  }
});

// GET one farmer by ID within the authenticated user's cooperative
router.get("/:id", ...staffAccess, async (req, res) => {
  try {
   const id = req.params.id;
const cooperativeId = req.user!.cooperativeId;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (typeof id !== "string" || !uuidPattern.test(id)) {
  return res.status(400).json({
    success: false,
    message: "Invalid farmer ID."
  });
}

    const { data, error } = await supabase
      .from("farmers")
      .select("*")
      .eq("id", id)
      .eq("cooperative_id", cooperativeId)
      .maybeSingle();

    if (error) {
      console.error("Farmer lookup failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve farmer."
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Farmer not found."
      });
    }

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error("Farmer lookup error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving farmer."
    });
  }
});

export default router;
