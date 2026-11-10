
import { Router } from "express";
import { supabase } from "../config/supabase";
import {
  requireAuth,
  requireRole
} from "../middleware/auth.middleware";

const router = Router();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const staffAccess = [
  requireAuth,
  requireRole("manager", "staff")
];

// GET all sales belonging to the user's cooperative
router.get("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;

    const { data, error } = await supabase
      .from("sales")
      .select(`
        id,
        sale_reference,
        buyer_id,
        sale_date,
        gross_amount_rwf,
        deductions_rwf,
        net_amount_rwf,
        status
      `)
      .eq("cooperative_id", cooperativeId)
      .order("sale_date", { ascending: false });

    if (error) {
      console.error("Sales query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve sales."
      });
    }

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Sales API error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving sales."
    });
  }
});

// GET one sale with its batch items
router.get("/:id", ...staffAccess, async (req, res) => {
  try {
    const id = req.params.id;
    const cooperativeId = req.user!.cooperativeId;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof id !== "string" || !uuidPattern.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sale ID."
      });
    }

    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select("*")
      .eq("id", id)
      .eq("cooperative_id", cooperativeId)
      .maybeSingle();

    if (saleError) {
      console.error("Sale lookup failed:", saleError.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve sale."
      });
    }

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found."
      });
    }

    const { data: items, error: itemsError } = await supabase
      .from("sale_batch_items")
      .select(`
        id,
        batch_id,
        quantity_kg,
        price_per_kg_rwf,
        gross_amount_rwf
      `)
      .eq("sale_id", id);

    if (itemsError) {
      console.error("Sale items query failed:", itemsError.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve sale items."
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...sale,
        items: items ?? [],
        totalQuantityKg: (items ?? []).reduce(
          (sum, item) => sum + Number(item.quantity_kg),
          0
        )
      }
    });

  } catch (error) {
    console.error("Sale lookup error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving sale."
    });
  }
});


router.post("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;
    const actorId = req.user!.id;

    const {
      buyerId,
      saleReference,
      saleDate,
      batchId,
      quantityKg,
      pricePerKgRwf,
      deductionsRwf
    } = req.body;

    if (
      typeof buyerId !== "string" ||
      !uuidPattern.test(buyerId) ||
      typeof batchId !== "string" ||
      !uuidPattern.test(batchId) ||
      typeof saleReference !== "string" ||
      !saleReference.trim() ||
      typeof saleDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(saleDate) ||
      typeof quantityKg !== "number" ||
      !Number.isFinite(quantityKg) ||
      quantityKg <= 0 ||
      typeof pricePerKgRwf !== "number" ||
      !Number.isSafeInteger(pricePerKgRwf) ||
      pricePerKgRwf < 0 ||
      typeof deductionsRwf !== "number" ||
      !Number.isSafeInteger(deductionsRwf) ||
      deductionsRwf < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid sale information."
      });
    }

    const { data, error } = await supabase.rpc(
      "create_mavunotrail_sale",
      {
        p_cooperative_id: cooperativeId,
        p_actor_id: actorId,
        p_buyer_id: buyerId,
        p_sale_reference: saleReference.trim(),
        p_sale_date: saleDate,
        p_batch_id: batchId,
        p_quantity_kg: quantityKg,
        p_price_per_kg_rwf: pricePerKgRwf,
        p_deductions_rwf: deductionsRwf
      }
    );

    if (error) {
      console.error("Sale creation failed:", error.message);

      return res.status(400).json({
        success: false,
        message: "Sale could not be created. Check the sale information.",
        error: error.message
      });
    }

    return res.status(201).json({
      success: true,
      message: "Sale and farmer allocations created successfully.",
      data
    });

  } catch (error) {
    console.error("Sale creation error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not create sale."
    });
  }
});


export default router;
