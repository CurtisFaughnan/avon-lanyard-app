emailBtn.onclick = async () => {
  const pass = prompt("Enter Email Home password:");
  if (!pass) {
    setStatus("Email canceled.");
    return;
  }

  setStatus("Sending email...");
  const emailRes = await apiPost("sendEmailHome", {
    student_id: sid,
    total_count: logRes.total_count,
    email_password: pass
  });

  setStatus(emailRes.ok ? "Email sent." : ("Email failed: " + (emailRes.error || "unknown")));
};
