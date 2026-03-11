// ===============================
// Doctor Appointment Functions
// ===============================
// Appointment
function markCompleted() {
    alert("Appointment marked as Completed");
}

function cancelAppointment() {
    alert("Appointment Cancelled");
}

// Treatment
document.addEventListener("DOMContentLoaded", function () {

    const form = document.getElementById("treatmentForm");

    if (form) {
        form.addEventListener("submit", function (event) {
            event.preventDefault(); // STOP refresh

            const patientName = document.getElementById("patientName").value;
            const disease = document.getElementById("disease").value;
            const medicine = document.getElementById("medicine").value;

            let treatments = JSON.parse(localStorage.getItem("treatments")) || [];

            treatments.push({
                patientName: patientName,
                disease: disease,
                medicine: medicine
            });

            localStorage.setItem("treatments", JSON.stringify(treatments));

            document.getElementById("successMessage").innerText =
                "Treatment Record Saved Successfully!";

            form.reset();
        });
    }

});

// ===============================
// Edit Profile Function
// ===============================

function updateProfile() {
    const inputs = document.querySelectorAll(".card input");

    const contact = inputs[0].value;
    const specialization = inputs[1].value;
    const time = inputs[2].value;

    alert(
        "Profile Updated!\n\n" +
        "Contact: " + contact + "\n" +
        "Specialization: " + specialization + "\n" +
        "Available Time: " + time
    );
}
function markCompleted() {
    alert("Appointment marked as Completed");
}

function cancelAppointment() {
    alert("Appointment Cancelled");
}

function saveTreatment() {
    alert("Treatment Record Saved Successfully");
}

function updateProfile() {
    alert("Profile Updated Successfully");
}
