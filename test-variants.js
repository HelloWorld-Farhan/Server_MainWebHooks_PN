const getNumberVariants = (num) => {
  if (!num || num === "Unknown") return [num];
  const digits = num.replace(/\D/g, "");
  const variants = new Set([num, digits]);
  
  // Handle double zero country code format: 0091XXXXXXXXXX
  if (digits.startsWith("00")) {
    const stripped = digits.substring(2);
    variants.add(stripped);
    variants.add("+" + stripped);
    if (stripped.startsWith("91")) {
      const national = stripped.substring(2);
      variants.add(national);
      variants.add("0" + national);
    }
  } else if (digits.startsWith("0")) {
    // e.g. 07969007102 -> 7969007102
    const stripped = digits.substring(1);
    variants.add(stripped);
    variants.add("+" + stripped);
  }

  // Handle Indian local format: 0XXXXXXXXXX (10 digits with leading 0)
  if (digits.startsWith("0") && digits.length === 11) {
    // e.g. 07969007102 -> 7969007102 -> 917969007102 -> +917969007102
    const without0 = digits.substring(1); // 7969007102
    variants.add(without0);
    variants.add("91" + without0);         // 917969007102
    variants.add("+91" + without0);        // +917969007102
    variants.add("9191" + without0);       // rare double-prefix
  }

  // Handle 10-digit Indian mobile: 9XXXXXXXXX
  if (!digits.startsWith("91") && digits.length === 10) {
    variants.add("91" + digits);
    variants.add("+91" + digits);
    variants.add("0" + digits);
  }

  // Strip leading 91 (India country code) variants
  if (digits.startsWith("9191") && digits.length >= 14) {
    // e.g. 91919429390110 -> 919429390110 -> +919429390110
    const stripped = digits.substring(2);
    variants.add(stripped);
    variants.add("+" + stripped);
  }
  if (digits.startsWith("91") && digits.length >= 12) {
    // e.g. 91917969126581 -> +91917969126581, or 917969126581 -> +917969126581
    variants.add("+" + digits);
    // Also try stripping one 91 prefix
    const stripped = digits.substring(2);
    if (stripped.length >= 10) {
      variants.add(stripped);
      variants.add("0" + stripped); // Add the 0 prefix variant for Indian numbers
      variants.add("+" + stripped);
      variants.add("91" + stripped);
      variants.add("+91" + stripped);
    }
  }
  // Also add without + prefix version
  variants.forEach(v => { if (v.startsWith("+")) variants.add(v.substring(1)); });
  
  return Array.from(variants);
};

const agentNumber = "917969007102"; // DID
const callingNo = "+918851860838";

const agentVariants = getNumberVariants(agentNumber);
const callingVariants = getNumberVariants(callingNo);
const allVariants = [...agentVariants, ...callingVariants];

console.log("allVariants:", allVariants);
console.log("Includes 08851860838?", allVariants.includes("08851860838"));
