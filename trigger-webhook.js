const axios = require('axios');

async function testWebhook() {
  try {
    const res = await axios.post('http://localhost:3004/api/webhooks/voice', {
      callid: "917969007102",
      calledno: "+918851860838", // Simulating what VoiceLink might send
      status: "ringing",
      custom_parameters: { companyId: "6a897a7c500636731c1f15da" }
    });
    console.log("Response:", res.data);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

testWebhook();
