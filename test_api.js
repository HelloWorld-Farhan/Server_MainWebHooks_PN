async function test() {
  try {
    const res = await fetch('http://localhost:3001/api/calls/inbound?companyId=6a87f72283ec91c0e34669db');
    const data = await res.json();
    console.log("Inbound calls count:", data.data ? data.data.length : data);
    if (data.data && data.data.length > 0) {
      console.log("First call:", data.data[0]);
    }
  } catch(e) {
    console.error(e.message);
  }
}
test();
