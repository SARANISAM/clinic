require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Gemini with the latest stable 3.1 model
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

/* =========================
   SUPABASE CONNECTION
   ========================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    db: { schema: "clinic" } 
  }
);

/* =========================
   DISCHARGE SYSTEM (AI & PDF READY)
   ========================= */

// ROUTE 1: Generate AI Draft Summary
app.get("/api/prepare-discharge/:appointmentId", async (req, res) => {
  const { appointmentId } = req.params;

  try {
    // 1. Fetch Appointment Data
    const { data: appointment, error: apptError } = await supabase
      .from("appointments")
      .select("*")
      .eq("appointment_id", appointmentId)
      .single();

    if (apptError || !appointment) {
      return res.status(404).json({ error: "Appointment record not found" });
    }

    // 2. Fetch Related Data (Patient, Treatment, Bills)
    const [patientRes, treatmentRes, billRes] = await Promise.all([
      supabase.from("patients").select("*").eq("patient_id", appointment.patient_id).single(),
      supabase.from("treatments").select("*").eq("appointment_id", appointmentId),
      supabase.from("bills").select("*").eq("appointment_id", appointmentId)
    ]);

    const patient = patientRes.data;
    const treatments = treatmentRes.data;
    const diagnosis = treatments?.[0]?.diagnosis || "General Consultation";
    const prescription = treatments?.[0]?.prescription || "Follow-up as needed";

    // 3. AI Generation Logic (Optimized for PDF Structure)
    const prompt = `
      Act as a professional medical officer. Generate a structured discharge summary.
      Use Markdown formatting (## for headers, ** for bold) so it can be converted to PDF.

      Patient: ${patient?.name || "Unknown"} (${patient?.age || "-"}y/o ${patient?.gender || "-"})
      Diagnosis: ${diagnosis}
      Prescription: ${prescription}

      Format the output with these exact headers:
      ## CLINICAL NARRATIVE
      ## DISCHARGE STATUS
      ## INSTRUCTIONS
    `;

    const result = await model.generateContent(prompt);
    const aiSummary = result.response.text();

    res.json({
      dbData: {
        ...appointment,
        patients: patient,
        treatments: treatments,
        bills: billRes.data
      },
      aiSummary
    });

  } catch (err) {
    console.error("❌ AI ERROR:", err);
    res.status(500).json({ error: "Failed to generate AI summary. Check API Key or connectivity." });
  }
});

// ROUTE 2: Finalize & Save to DB
app.post("/api/finalize-discharge", async (req, res) => {
  const { appointment_id, patient_id, final_summary } = req.body;

  if (!appointment_id || !patient_id || !final_summary) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Insert into discharge table
    const { error: insertError } = await supabase
      .from("discharge")
      .insert([
        {
          discharge_id: uuidv4(),
          appointment_id,
          patient_id,
          generated_summary: final_summary,
          created_at: new Date().toISOString()
        }
      ]);

    if (insertError) throw insertError;

    // Update appointment status to Completed
    await supabase
      .from("appointments")
      .update({ status: "Completed" })
      .eq("appointment_id", appointment_id);

    res.json({ success: true, message: "✅ Discharge saved successfully" });

  } catch (err) {
    console.error("❌ DB SAVE ERROR:", err);
    res.status(500).json({ error: "Failed to save discharge record." });
  }
});

/* =========================
   PATIENT & DOCTOR MANAGEMENT
   ========================= */

app.post("/patients", async (req, res) => {
  const { name, age, gender, phone } = req.body;
  const { data, error } = await supabase
    .from("patients")
    .insert([{ patient_id: uuidv4(), name, age, gender, phone }]);
  
  if (error) return res.status(500).json(error);
  res.json(data);
});

app.get("/patients", async (req, res) => {
  const { data, error } = await supabase.from("patients").select("*");
  if (error) return res.status(500).json(error);
  res.json(data);
});

/* =========================
   AUTHENTICATION (LOGIN/SIGNUP)
   ========================= */

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .eq("password", password);

  if (error) return res.status(500).json(error);
  if (!data || data.length === 0) return res.json({ message: "Invalid credentials" });

  res.json({ message: "Login successful", user: data[0] });
});

/* =========================
   SERVER BOOTUP (RENDER COMPATIBLE)
   ========================= */

const PORT = process.env.PORT || 5000;

// '0.0.0.0' is mandatory for Render's port discovery to work!
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 Server live on port ${PORT}
  🛠 Model: Gemini 3.1 Flash-Lite
  📂 Schema: Clinic
  `);
});