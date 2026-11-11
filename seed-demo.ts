import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;

const supabase = createClient(supabaseUrl, supabaseSecretKey);

async function seed() {
  console.log("Seeding database with demo data...");

  // Get or create a cooperative
  let { data: cooperatives, error: coopError } = await supabase
    .from("cooperatives")
    .select("id")
    .limit(1);

  if (coopError) throw coopError;

  let cooperativeId: string;
  if (cooperatives && cooperatives.length > 0) {
    cooperativeId = cooperatives[0].id;
    console.log(`Using existing cooperative: ${cooperativeId}`);
  } else {
    const { data: newCoop, error: newCoopError } = await supabase
      .from("cooperatives")
      .insert({ name: "Mavuno Cooperative", location: "Musanze, Rwanda", status: "active" })
      .select("id")
      .single();
    if (newCoopError) throw newCoopError;
    cooperativeId = newCoop.id;
    console.log(`Created new cooperative: ${cooperativeId}`);
  }

  // Get or create an app user (staff)
  let { data: users, error: userError } = await supabase
    .from("app_users")
    .select("id")
    .eq("cooperative_id", cooperativeId)
    .limit(1);

  if (userError) throw userError;

  let actorId: string;
  if (users && users.length > 0) {
    actorId = users[0].id;
    console.log(`Using existing staff user: ${actorId}`);
  } else {
    const { data: newUser, error: newUserError } = await supabase
      .from("app_users")
      .insert({
        cooperative_id: cooperativeId,
        full_name: "Cooperative Manager",
        role: "manager",
        wallet_address: "0x1234567890123456789012345678901234567890",
        status: "active"
      })
      .select("id")
      .single();
    if (newUserError) throw newUserError;
    actorId = newUser.id;
    console.log(`Created new staff user: ${actorId}`);
  }

  // Create collection centres
  const centres = [
    { name: "Ruhengeri Centre", location: "Ruhengeri, Musanze", status: "active" },
    { name: "Kinigi Centre", location: "Kinigi, Musanze", status: "active" },
    { name: "Muhoza Centre", location: "Muhoza, Musanze", status: "active" }
  ];

  const centreIds: string[] = [];
  for (const centre of centres) {
    const { data: existing } = await supabase
      .from("collection_centres")
      .select("id")
      .eq("cooperative_id", cooperativeId)
      .eq("name", centre.name)
      .maybeSingle();

    if (existing) {
      centreIds.push(existing.id);
      console.log(`Centre exists: ${centre.name}`);
    } else {
      const { data: newCentre, error } = await supabase
        .from("collection_centres")
        .insert({ ...centre, cooperative_id: cooperativeId })
        .select("id")
        .single();
      if (error) throw error;
      centreIds.push(newCentre.id);
      console.log(`Created centre: ${centre.name}`);
    }
  }

  // Create buyers
  const buyers = [
    { name: "Amahoro Foods", contact_person: "Jean Baptiste", phone: "+250 788 123 456", status: "active" },
    { name: "Rwanda Agri-Business", contact_person: "Marie Claire", phone: "+250 788 654 321", status: "active" },
    { name: "Kigali Fresh Market", contact_person: "Eric Niyonzima", phone: "+250 788 987 654", status: "active" }
  ];

  const buyerIds: string[] = [];
  for (const buyer of buyers) {
    const { data: existing } = await supabase
      .from("buyers")
      .select("id")
      .eq("cooperative_id", cooperativeId)
      .eq("name", buyer.name)
      .maybeSingle();

    if (existing) {
      buyerIds.push(existing.id);
      console.log(`Buyer exists: ${buyer.name}`);
    } else {
      const { data: newBuyer, error } = await supabase
        .from("buyers")
        .insert({ ...buyer, cooperative_id: cooperativeId })
        .select("id")
        .single();
      if (error) throw error;
      buyerIds.push(newBuyer.id);
      console.log(`Created buyer: ${buyer.name}`);
    }
  }

  // Create demo farmers
  const farmers = [
    { farmer_code: "F-0248", full_name: "Aline Uwimana", phone: "+250 788 111 222", village: "Ruhengeri", sector: "Musanze", district: "Musanze", status: "active" },
    { farmer_code: "F-0312", full_name: "Jean Bosco Niyonzima", phone: "+250 788 333 444", village: "Kinigi", sector: "Musanze", district: "Musanze", status: "active" },
    { farmer_code: "F-0156", full_name: "Marie Rose Mukamana", phone: "+250 788 555 666", village: "Muhoza", sector: "Musanze", district: "Musanze", status: "active" },
    { farmer_code: "F-0421", full_name: "Emmanuel Hakizimana", phone: "+250 788 777 888", village: "Ruhengeri", sector: "Musanze", district: "Musanze", status: "active" }
  ];

  const farmerIds: string[] = [];
  for (const farmer of farmers) {
    const { data: existing } = await supabase
      .from("farmers")
      .select("id")
      .eq("cooperative_id", cooperativeId)
      .eq("farmer_code", farmer.farmer_code)
      .maybeSingle();

    if (existing) {
      farmerIds.push(existing.id);
      console.log(`Farmer exists: ${farmer.farmer_code} - ${farmer.full_name}`);
    } else {
      const { data: newFarmer, error } = await supabase
        .from("farmers")
        .insert({ ...farmer, cooperative_id: cooperativeId })
        .select("id")
        .single();
      if (error) throw error;
      farmerIds.push(newFarmer.id);
      console.log(`Created farmer: ${farmer.farmer_code} - ${farmer.full_name}`);
    }
  }

  // Create demo deliveries
  const deliveries = [
    { farmer_index: 0, centre_index: 0, reference: "MT-D-2025-0142", quantity: 860, grade: "A", date: "2025-06-12" },
    { farmer_index: 1, centre_index: 1, reference: "MT-D-2025-0143", quantity: 1200, grade: "A", date: "2025-06-15" },
    { farmer_index: 2, centre_index: 2, reference: "MT-D-2025-0144", quantity: 950, grade: "B", date: "2025-06-18" },
    { farmer_index: 3, centre_index: 0, reference: "MT-D-2025-0145", quantity: 1100, grade: "A", date: "2025-06-20" }
  ];

  const deliveryIds: string[] = [];
  const deliveryRecords: any[] = [];
  for (const delivery of deliveries) {
    const { data: existing } = await supabase
      .from("deliveries")
      .select("id")
      .eq("cooperative_id", cooperativeId)
      .eq("delivery_reference", delivery.reference)
      .maybeSingle();

    if (existing) {
      deliveryIds.push(existing.id);
      deliveryRecords.push({ id: existing.id, ...delivery });
      console.log(`Delivery exists: ${delivery.reference}`);
    } else {
      const { data: newDelivery, error } = await supabase
        .from("deliveries")
        .insert({
          cooperative_id: cooperativeId,
          farmer_id: farmerIds[delivery.farmer_index],
          collection_centre_id: centreIds[delivery.centre_index],
          delivery_reference: delivery.reference,
          quantity_kg: delivery.quantity,
          grade: delivery.grade,
          delivered_at: delivery.date,
          recorded_by: actorId,
          status: "recorded"
        })
        .select("id")
        .single();
      if (error) throw error;
      deliveryIds.push(newDelivery.id);
      deliveryRecords.push({ id: newDelivery.id, ...delivery });
      console.log(`Created delivery: ${delivery.reference} - ${delivery.quantity}kg Grade ${delivery.grade}`);
    }
  }

  // Create audit events for deliveries
  for (const record of deliveryRecords) {
    const { data: existingAudit } = await supabase
      .from("audit_events")
      .select("id")
      .eq("entity_type", "delivery")
      .eq("entity_id", record.id)
      .eq("event_type", "delivery_recorded")
      .maybeSingle();

    if (!existingAudit) {
      const { error } = await supabase
        .from("audit_events")
        .insert({
          cooperative_id: cooperativeId,
          actor_id: actorId,
          entity_type: "delivery",
          entity_id: record.id,
          event_type: "delivery_recorded",
          previous_values: null,
          new_values: {
            delivery_reference: record.reference,
            farmer_id: farmerIds[deliveries.findIndex(d => d.reference === record.reference)],
            quantity_kg: record.quantity,
            grade: record.grade,
            status: "recorded"
          },
          reason: "Initial delivery record"
        });
      if (error) console.error(`Audit event creation failed for ${record.reference}:`, error.message);
      else console.log(`Created audit event for delivery: ${record.reference}`);
    } else {
      console.log(`Audit event exists for delivery: ${record.reference}`);
    }
  }

  // Create a batch for Grade A deliveries
  const { data: batchA } = await supabase
    .from("batches")
    .select("id")
    .eq("cooperative_id", cooperativeId)
    .eq("batch_reference", "MT-B-2025-041")
    .maybeSingle();

  let batchAId: string;
  if (batchA) {
    batchAId = batchA.id;
    console.log(`Batch exists: MT-B-2025-041`);
  } else {
    const { data: newBatch, error } = await supabase
      .from("batches")
      .insert({
        cooperative_id: cooperativeId,
        batch_reference: "MT-B-2025-041",
        grade: "A",
        status: "open",
        created_by: actorId
      })
      .select("id")
      .single();
    if (error) throw error;
    batchAId = newBatch.id;
    console.log(`Created batch: MT-B-2025-041 Grade A`);

    // Assign Grade A deliveries to batch
    const gradeADeliveries = [0, 1, 3]; // indices of Grade A deliveries
    const assignments = gradeADeliveries.map((idx, i) => ({
      batch_id: batchAId,
      delivery_id: deliveryIds[idx],
      quantity_kg: deliveries[idx].quantity,
      assigned_by: actorId
    }));

    const { error: assignError } = await supabase
      .from("batch_deliveries")
      .insert(assignments);
    if (assignError) throw assignError;
    console.log(`Assigned ${assignments.length} deliveries to batch MT-B-2025-041`);
  }

  // Create a sale for the batch
  const { data: sale } = await supabase
    .from("sales")
    .select("id")
    .eq("cooperative_id", cooperativeId)
    .eq("sale_reference", "MT-S-2025-021")
    .maybeSingle();

  if (!sale) {
    // Use the RPC function to create sale with allocations
    const { data: saleResult, error: saleError } = await supabase.rpc(
      "create_mavunotrail_sale",
      {
        p_cooperative_id: cooperativeId,
        p_actor_id: actorId,
        p_buyer_id: buyerIds[0], // Amahoro Foods
        p_sale_reference: "MT-S-2025-021",
        p_sale_date: "2025-07-15",
        p_batch_id: batchAId,
        p_quantity_kg: 3160, // Total of Grade A deliveries
        p_price_per_kg_rwf: 450,
        p_deductions_rwf: 150000
      }
    );
    if (saleError) {
      console.error("Sale creation error:", saleError);
    } else {
      console.log(`Created sale: MT-S-2025-021 with allocations`);
    }
  } else {
    console.log(`Sale exists: MT-S-2025-021`);
  }

  // Create demo payments for F-0248's allocations
  const { data: allocations } = await supabase
    .from("farmer_allocations")
    .select("id, farmer_id, net_amount_rwf")
    .eq("farmer_id", farmerIds[0])
    .eq("status", "approved");

  if (allocations && allocations.length > 0) {
    for (const allocation of allocations) {
      const { data: existingPayment } = await supabase
        .from("payment_records")
        .select("id")
        .eq("allocation_id", allocation.id)
        .maybeSingle();

      if (!existingPayment) {
        const paymentAmount = Math.floor(allocation.net_amount_rwf * 0.65); // 65% paid
        const { error } = await supabase
          .from("payment_records")
          .insert({
            allocation_id: allocation.id,
            payment_reference: `DEMO-PAY-${Date.now()}-${allocation.id.slice(0, 6)}`,
            amount_rwf: paymentAmount,
            payment_method: "mobile_money",
            payment_date: "2025-08-01",
            status: "recorded",
            notes: "SIMULATION ONLY — no real money was transferred.",
            external_reference: "DEMO-NOT-A-REAL-TRANSFER",
            recorded_by: actorId
          });
        if (error) throw error;
        console.log(`Created payment for allocation ${allocation.id}: ${paymentAmount} FRW`);
      }
    }
  }

  console.log("\n✅ Database seeding complete!");
  console.log("\nDemo farmer codes: F-0248, F-0312, F-0156, F-0421");
  console.log("Use these codes in the Farmer Demo portal.");
}

seed().catch(console.error);