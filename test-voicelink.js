const fetch = require('node-fetch');

const VOICELINK_API_URL = "https://app.voicelink.co.in/api";

async function loginToVoicelink() {
  console.log("Logging in...");
  const loginRes = await fetch(`${VOICELINK_API_URL}/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      username: "propnex",
      password: "PropnexAi2025@#",
    }),
  });

  if (!loginRes.ok) {
    console.error("Login failed:", await loginRes.text());
    process.exit(1);
  }

  const loginData = await loginRes.json();
  console.log("Login success!", loginData);
  const token = loginData.data?.access_token || loginData.access_token;
  
  console.log("Token:", token);
  
  // Test add lead
  console.log("Testing add_lead...");
  const res = await fetch(`${VOICELINK_API_URL}/v1/add_lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      did_number: "917969007102",
      customer_number: "8851860838",
      country_code: "91",
      custom_parameters: JSON.stringify({ name: "test", companyId: "test_company" }),
    }),
  });
  
  const text = await res.text();
  console.log("add_lead status:", res.status);
  console.log("add_lead response:", text);
}

loginToVoicelink().catch(console.error);
