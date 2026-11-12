import { Router } from "express";
import { supabase } from "../config/supabase";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET a farmer's financial statement
// Allows staff to view any farmer, and farmers to view only their own statement
router.get("/farmer/:farmerId", requireAuth, requireRole("manager", "staff", "farmer"), async (req, res) => {
  try {
    const farmerId = String(req.params.farmerId);

    if (!uuidPattern.test(farmerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid farmer ID."
      });
    }

    // Farmers can only access their own statement
    // Farmers can only access their own statement
if (
  req.user!.role === "farmer" &&
  req.user!.farmerId !== farmerId
) {
  return res.status(403).json({
    success: false,
    message: "You can only access your own statement."
  });
}

    // Retrieve farmer
    const { data: farmer, error: farmerError } = await supabase
      .from("farmers")
      .select("id, farmer_code, full_name, phone, village, district")
      .eq("id", farmerId)
      .eq("cooperative_id", req.user!.cooperativeId)
      .maybeSingle();

    if (farmerError) {
      return res.status(500).json({
        success: false,
        message: "Could not retrieve farmer."
      });
    }

    if (!farmer) {
      return res.status(404).json({
        success: false,
        message: "Farmer not found."
      });
    }

    // Retrieve approved allocations
    const { data: allocations, error: allocationError } =
      await supabase
        .from("farmer_allocations")
        .select(`
          id,
          sale_batch_item_id,
          eligible_quantity_kg,
          contribution_share,
          gross_amount_rwf,
          deductions_rwf,
          net_amount_rwf,
          status,
          approved_at
        `)
        .eq("farmer_id", farmerId)
        .eq("status", "approved")
        .order("created_at", { ascending: false });

    if (allocationError) {
      return res.status(500).json({
        success: false,
        message: "Could not retrieve allocations."
      });
    }

    const allocationIds = (allocations ?? []).map(
      allocation => allocation.id
    );

    // Retrieve payment records
    let payments: any[] = [];

    if (allocationIds.length > 0) {
      const { data, error } = await supabase
        .from("payment_records")
        .select(`
          id,
          allocation_id,
          payment_reference,
          amount_rwf,
          payment_method,
          payment_date,
          status
        `)
        .in("allocation_id", allocationIds)
        .order("payment_date", { ascending: false });

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Could not retrieve payment records."
        });
      }

      payments = data ?? [];
    }

    // Only recorded payments count as paid
    const totalAllocatedRwf = (allocations ?? [])
      .reduce(
        (sum, item) => sum + Number(item.net_amount_rwf),
        0
      );

    const totalPaidRwf = payments
      .filter(payment => payment.status === "recorded")
      .reduce(
        (sum, payment) => sum + Number(payment.amount_rwf),
        0
      );

    const outstandingRwf = totalAllocatedRwf - totalPaidRwf;

    return res.status(200).json({
      success: true,
      data: {
        farmer,
        summary: {
          totalAllocatedRwf,
          totalPaidRwf,
          outstandingRwf
        },
        allocations,
        payments
      }
    });

  } catch (error) {
    console.error("Farmer statement error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error generating farmer statement."
    });
  }
});

export default router;
