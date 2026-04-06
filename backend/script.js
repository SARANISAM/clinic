require("dotenv").config()

const express = require("express")
const cors = require("cors")
const { createClient } = require("@supabase/supabase-js")
const { v4: uuidv4 } = require("uuid")
// ADD THIS LINE:
const { GoogleGenerativeAI } = require("@google/generative-ai") 

const app = express()

app.use(cors())
app.use(express.json())
// Initialize Gemini with your .env key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)


/* =========================
   SUPABASE CONNECTION
   ========================= */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    db: { schema: "clinic" }   // IMPORTANT: uses clinic schema
  }
)
// Add this to your backend file
app.get('/', (req, res) => {
  res.send('Backend is running successfully!');
});

/* =========================
   TEST DATABASE CONNECTION
========================= */


app.get("/test-db", async (req,res)=>{

  const {data,error} = await supabase
  .from("patients")
  .select("*")

  if(error){
    return res.status(500).json({
      message:"Database connection failed",
      error:error
    })
  }

  res.json({
    message:"Database connected successfully",
    data:data
  })

})
/* =========================
   TEST SIGNUP (Browser Test)
========================= */
/* =========================
   DISCHARGE SYSTEM (AI)
   ========================= */

// ROUTE 1: Get AI Draft
/* =========================
   REVISED DISCHARGE SYSTEM (SAFE VERSION)
   ========================= */

app.get("/api/prepare-discharge/:appointmentId", async (req, res) => {
  const { appointmentId } = req.params;
  let dbData = {}; // Persistent store for DB results

  try {
    // 1. PHASE ONE: DATABASE FETCHING
    // We fetch the core appointment first to get the patient_id
    const { data: appointment, error: apptError } = await supabase
      .from("appointments")
      .select("*")
      .eq("appointment_id", appointmentId)
      .maybeSingle();

    if (apptError || !appointment) {
      return res.status(404).json({ error: "Visit record not found" });
    }

    // Fetch related records in parallel (or sequence for clarity)
    const { data: patient } = await supabase
      .from("patients")
      .select("*")
      .eq("patient_id", appointment.patient_id)
      .single();

    const { data: treatments } = await supabase
      .from("treatments")
      .select("*")
      .eq("appointment_id", appointmentId);

    const { data: bills } = await supabase
      .from("bills")
      .select("*")
      .eq("appointment_id", appointmentId);

    // Construct the data object for the frontend
    dbData = { 
      ...appointment, 
      patients: patient, 
      treatments: treatments || [], 
      bills: bills || [] 
    };

    // 2. PHASE TWO: AI GENERATION (Wrapped in a separate Try/Catch)
    let aiSummary = "";
    try {
      // Switched to 'gemini-1.5-flash' for maximum stability on Render
      const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
      
      const diagnosis = treatments?.[0]?.diagnosis || "General Consultation";
      const prescription = treatments?.[0]?.prescription || "Follow-up as needed";

      const prompt = `
        Act as a professional medical officer. Generate a structured discharge summary. 
        Return the response in clean Markdown format using headers (##) and bold text.

        Patient: ${patient?.name || "Unknown"} (${patient?.age || "-"}y/o ${patient?.gender || "-"})
        Diagnosis: ${diagnosis}
        Prescription: ${prescription}
        
        Structure the response as follows:
        ## CLINICAL NARRATIVE
        ## DISCHARGE STATUS
        ## INSTRUCTIONS
      `;

      const result = await model.generateContent(prompt);
      aiSummary = result.response.text();

    } catch (aiErr) {
      // If AI fails, we LOG the error but DO NOT crash the response
      console.error("⚠️ AI Generation Failed:", aiErr.message);
      aiSummary = "## AI SUMMARY UNAVAILABLE\n\nThere was a connection issue with the AI service. The patient's clinical records have been loaded successfully below. Please draft the summary manually.";
    }

    // 3. PHASE THREE: UNIFIED RESPONSE
    // This sends back the DB data (Name, Diag, etc.) AND whatever AI result we got
    res.json({ dbData, aiSummary });

  } catch (dbErr) {
    // This only triggers if the Database itself fails
    console.error("❌ Database Fetch Error:", dbErr);
    res.status(500).json({ 
      error: "Database fetch failed", 
      details: dbErr.message 
    });
  }
});

// ROUTE 2: Finalize & Insert into Discharge Table
app.post("/api/finalize-discharge", async (req, res) => {
  const { appointment_id, patient_id, final_summary } = req.body;

  try {
    console.log("🚀 Incoming:", { appointment_id, patient_id });

    // ✅ Validate input
    if (!appointment_id || !patient_id || !final_summary) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ✅ Insert into discharge table
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

    if (insertError) {
      console.error("❌ INSERT ERROR:", insertError);
      return res.status(500).json({ error: insertError.message });
    }

    // ✅ Update appointment status
    const { error: updateError } = await supabase
      .from("appointments")
      .update({ status: "Completed" })
      .eq("appointment_id", appointment_id);

    if (updateError) {
      console.error("❌ UPDATE ERROR:", updateError);
    }

    res.json({
      success: true,
      message: "✅ Discharge saved successfully"
    });

  } catch (err) {
    console.error("❌ FINAL ERROR:", err);
    res.status(500).json({ error: "Failed to save discharge record." });
  }
});
/* =========================
   TEST SIGNUP (Browser Test)
========================= */

app.get("/test-signup", async (req,res)=>{

 const {data,error} = await supabase
 .from("users")
 .insert([
  {
   user_id: uuidv4(),
   name: "Test Receptionist",
   email: "testreception@clinic.com",
   password: "rec123",
   role_id: 2
  }
 ])
 .select()

 if(error){
  return res.json({
   message:"Signup failed",
   error:error
  })
 }

 res.json({
  message:"Signup working",
  inserted:data
 })

})

/* =========================
   PATIENT MANAGEMENT
========================= */

// Add Patient
app.post("/patients", async (req, res) => {

  const { name, age, gender, phone } = req.body

  const { data, error } = await supabase
    .from("patients")
    .insert([
      {
        patient_id: uuidv4(),
        name,
        age,
        gender,
        phone
      }
    ])

  if (error) return res.status(500).json(error)

  res.json(data)
})


// View Patients
app.get("/patients", async (req, res) => {

  const { data, error } = await supabase
    .from("patients")
    .select("*")

  if (error) return res.status(500).json(error)

  res.json(data)
})


// Update Patient
app.put("/patients/:id", async (req, res) => {

  const id = req.params.id
  const { name, age, gender, phone } = req.body

  const { data, error } = await supabase
    .from("patients")
    .update({ name, age, gender, phone })
    .eq("patient_id", id)

  if (error) return res.status(500).json(error)

  res.json(data)
})

/* =========================
   DOCTOR MANAGEMENT
========================= */

// Add Doctor
app.post("/doctors", async (req, res) => {

  const { user_id, specialization, availability, email, password } = req.body

  const { data, error } = await supabase
    .from("doctors")
    .insert([
      {
        doctor_id: uuidv4(),
        user_id,
        specialization,
        availability,
        email,
        password
      }
    ])

  if (error) return res.status(500).json(error)

  res.json(data)
})

// View Doctors
app.get("/doctors", async (req, res) => {

  const { data, error } = await supabase
    .from("doctors")
    .select("*")

  if (error) return res.status(500).json(error)

  res.json(data)
})

/* =========================
   APPOINTMENT MANAGEMENT
========================= */

// Book Appointment
app.post("/appointments", async (req, res) => {

  const { patient_id, doctor_id, appointment_date, appointment_time } = req.body

  const { data, error } = await supabase
    .from("appointments")
    .insert([
      {
        appointment_id: uuidv4(),
        patient_id,
        doctor_id,
        appointment_date,
        appointment_time,
        status: "Booked"
      }
    ])

  if (error) return res.status(500).json(error)

  res.json(data)
})


// View Daily Appointments
app.get("/appointments/:date", async (req, res) => {

  const date = req.params.date

  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("appointment_date", date)

  if (error) return res.status(500).json(error)

  res.json(data)
})


// Cancel Appointment
app.put("/appointments/cancel/:id", async (req, res) => {

  const id = req.params.id

  const { data, error } = await supabase
    .from("appointments")
    .update({ status: "Cancelled" })
    .eq("appointment_id", id)

  if (error) return res.status(500).json(error)

  res.json(data)
})

/* =========================
   TREATMENT RECORDS
========================= */

// Store Diagnosis & Prescription
app.post("/treatments", async (req, res) => {

  const { appointment_id, diagnosis, prescription } = req.body

  const { data, error } = await supabase
    .from("treatments")
    .insert([
      {
        treatment_id: uuidv4(),
        appointment_id,
        diagnosis,
        prescription
      }
    ])

  if (error) return res.status(500).json(error)

  res.json(data)
})

/* =========================
   BILLING MANAGEMENT
========================= */
// =========================
// BILLING MANAGEMENT
// =========================

// STORE BILL
app.post("/bills", async (req, res) => {

  const {
    patient_id,
    consultation,
    tests,
    medicines,
    others,
    amount,
    payment_status
  } = req.body;

  if (!patient_id || !amount) {
    return res.status(400).json({
      error: "patient_id and amount are required"
    });
  }

  try {

    const { data, error } = await supabase
      .from("bills")
      .insert([{
        bill_id: uuidv4(),
        patient_id,
        consultation: consultation || 0,
        tests: tests || 0,
        medicines: medicines || 0,
        others: others || 0,
        amount,
        bill_date: new Date(),
        payment_status: payment_status || "Pending"
      }])
      .select();

    if (error) return res.status(500).json(error);

    res.json({
      message: "Bill stored successfully",
      data
    });

  } catch (err) {
    res.status(500).json({
      error: "Server error"
    });
  }
});


// GET BILLS OF PATIENT
app.get("/bills/:patient_id", async (req, res) => {

  const patient_id = req.params.patient_id;

  try {

    const { data, error } = await supabase
      .from("bills")
      .select("*")
      .eq("patient_id", patient_id)
      .order("bill_date", { ascending: false });

    if (error) return res.status(500).json(error);

    res.json(data);

  } catch (err) {
    res.status(500).json({
      error: "Server error"
    });
  }
});


// PAY BILL
app.put("/pay-bill/:bill_id", async (req, res) => {

  const bill_id = req.params.bill_id;

  try {

    const { data, error } = await supabase
      .from("bills")
      .update({ payment_status: "Paid" })
      .eq("bill_id", bill_id)
      .select();

    if (error) return res.status(500).json(error);

    res.json({
      message: "Payment updated",
      data
    });

  } catch (err) {
    res.status(500).json({
      error: "Server error"
    });
  }
});



/* =========================
   RECEPTIONIST SIGNUP
========================= */

app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body

  try {
    // 🔹 Step 1: Get role_id from roles table
    const { data: roleData, error: roleError } = await supabase
      .from("roles")
      .select("role_id")
      .eq("role_name", "receptionist") // change if needed
      .single()

    if (roleError || !roleData) {
      return res.status(400).json({
        error: "Role not found"
      })
    }

    // 🔹 Step 2: Insert into users table
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          user_id: uuidv4(),
          name,
          email,
          password,
          role_id: roleData.role_id
        }
      ])
      .select()

    if (error) {
      return res.status(500).json(error)
    }

    res.json({
      message: "User registered successfully",
      user: data
    })

  } catch (err) {
    res.status(500).json({
      error: "Server error"
    })
  }
})
/* =========================
   RECEPTIONIST LOGIN
========================= */

app.post("/login", async (req, res) => {

  const { email, password } = req.body

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .eq("password", password)

  if (error) return res.status(500).json(error)

  if (!data || data.length === 0) {
    return res.json({
      message: "Invalid email or password"
    })
  }

  res.json({
    message: "Login successful",
    user: data[0]
  })
})
/* =========================
   DOCTOR LOGIN
========================= */

app.post("/doctor-login", async (req, res) => {

  const { email, password } = req.body

  const { data, error } = await supabase
    .from("users")
    .select(`
      user_id,
      name,
      email,
      doctors (
        doctor_id,
        specialization,
        availability
      )
    `)
    .eq("email", email)
    .eq("password", password)

  if (error) return res.status(500).json(error)

  if (!data || data.length === 0) {
    return res.json({
      message: "Invalid doctor credentials"
    })
  }

  res.json({
    message: "Doctor login successful",
    doctor: data[0]
  })
})
/* =========================
   SERVER
========================= */

// Use the PORT provided by Render, or default to 5000 for local development
const PORT = process.env.PORT || 5000;

// Adding '0.0.0.0' is the key to making it visible to Render's port scanner
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is live and listening on port ${PORT}`);
});