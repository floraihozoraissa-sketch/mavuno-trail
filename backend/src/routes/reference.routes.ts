import { Router } from "express";
import { supabase } from "../config/supabase";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();
const staffAccess = [requireAuth, requireRole("manager", "staff")];

router.get("/collection-centres", ...staffAccess, async (req, res) => {
  const { data, error } = await supabase
    .from("collection_centres")
    .select("id, name, status")
    .eq("cooperative_id", req.user!.cooperativeId)
    .eq("status", "active")
    .order("name");

  if (error) return res.status(500).json({ success: false, message: "Could not load collection centres." });
  return res.json({ success: true, data: data ?? [] });
});

router.get("/buyers", ...staffAccess, async (req, res) => {
  const { data, error } = await supabase
    .from("buyers")
    .select("id, name")
    .eq("cooperative_id", req.user!.cooperativeId)
    .order("name");

  if (error) return res.status(500).json({ success: false, message: "Could not load buyers." });
  return res.json({ success: true, data: data ?? [] });
});

export default router;
