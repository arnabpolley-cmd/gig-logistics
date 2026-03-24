export default async function handler(req, res) {
  // 1. Method & Security Check
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { rate } = req.body;
  const shopDomain = 's6bcd1-ar.myshopify.com';
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN; 
  const gigToken = process.env.GIG_ACCESS_TOKEN; 
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;

  try {
    const countryMap = { "NG": "Nigeria" };

    // --- STEP 1: SENDER ---
    const locRes = await fetch(`https://${shopDomain}/admin/api/2026-01/locations.json`, {
      headers: { "X-Shopify-Access-Token": adminToken }
    });
    const locData = await locRes.json();
    const primaryLoc = locData.locations?.find(l => l.active) || locData.locations?.[0];

    if (!primaryLoc) {
      console.error("No Shopify locations found via Admin API.");
      return res.status(200).json({ rates: [] });
    }

    const cleanAddress1 = primaryLoc.address1?.replace(/^,\s*|\s*,\s*$/g, '').replace(/,\s*,\s*/g, ', ');
    const sParts = [cleanAddress1, primaryLoc.address2, primaryLoc.city, primaryLoc.province, primaryLoc.zip, primaryLoc.country_name]
      .filter(p => p && p.trim() !== "");
    const sAddrStr = sParts.join(", ");

    const sGeoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(sAddrStr)}&key=${googleApiKey}`);
    const sGeoData = await sGeoRes.json();

    // --- STEP 2: RECEIVER ---
    const dest = rate.destination;
    const rCountry = countryMap[dest.country] || dest.country;
    const rParts = [dest.address1, dest.address2, dest.city, dest.province, dest.postal_code, rCountry]
      .filter(p => p && p.trim() !== "");
    const rAddrStr = rParts.join(", ");

    const rGeoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(rAddrStr)}&key=${googleApiKey}`);
    const rGeoData = await rGeoRes.json();

    // --- STEP 3: GEOCODING VALIDATION & LOGGING ---
    const senderFound = sGeoData.results && sGeoData.results.length > 0;
    const receiverFound = rGeoData.results && rGeoData.results.length > 0;

    console.log("=== SENDER DETAILS ===");
    console.log("Original Address1:", primaryLoc.address1);
    console.log("Cleaned Address1:", cleanAddress1);
    console.log("Address Components:", { address1: primaryLoc.address1, city: primaryLoc.city, province: primaryLoc.province, zip: primaryLoc.zip });
    console.log("Geocoding Result:", senderFound ? sGeoData.results[0].geometry.location : "NOT FOUND");

    console.log("=== RECEIVER DETAILS ===");
    console.log("Geocoding Query:", rAddrStr);
    console.log("Geocoding Result:", receiverFound ? rGeoData.results[0].geometry.location : "NOT FOUND");

    console.log("Shipment Items Sent to GIG:");
    rate.items.forEach((i) => {
      console.log({
        ItemName: i.name,
        Quantity: i.quantity,
        Weight: (i.grams / 1000) || 0.5,
        Value_In_Naira: Math.round((i.price * i.quantity) / 100), // Logged for your visibility
        Description: i.title || i.name
      });
    });

    if (!senderFound || !receiverFound) {
      console.error(`Geocoding failed. S:${senderFound} R:${receiverFound}`);
      return res.status(200).json({ rates: [] });
    }

    // --- STEP 4: GIG API CALL ---
    const gigRes = await fetch("https://dev-thirdpartynode.theagilitysystems.com/price/v3", {
      method: "POST",
      headers: { "access-token": gigToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        "VehicleType": 1,
        "ReceiverLocation": { 
          "Latitude": rGeoData.results[0].geometry.location.lat, 
          "Longitude": rGeoData.results[0].geometry.location.lng 
        },
        "SenderLocation": { 
          "Latitude": sGeoData.results[0].geometry.location.lat, 
          "Longitude": sGeoData.results[0].geometry.location.lng 
        },
        "IsPriorityShipment": false,
        "PickUpOptions": 0,
        "ShipmentItems": rate.items.map(i => ({
          "ItemName": i.name,
          "Quantity": i.quantity,
          "Weight": (i.grams / 1000) || 0.5, // Added || 0.5 guard just in case
          "IsVolumetric": false,
          "ShipmentType": 1,
          "Value": Math.round((i.price * i.quantity) / 100), // CHANGE: Divided by 100 to convert Kobo to Naira
          "Description": i.title || i.name
        }))
      })
    });

    const gigResult = await gigRes.json();

    if (!gigResult.data || !gigResult.data.GrandTotal) {
      console.error("GIG API failure:", gigResult);
      return res.status(200).json({ rates: [] });
    }

    // --- STEP 5: FINAL SUCCESS RESPONSE ---
    return res.status(200).json({
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-PRECISION-LIVE",
        // CHANGE: Multiplied by 100 to convert Naira back to Kobo for Shopify
        total_price: (Math.round(gigResult.data.GrandTotal * 100)).toString(), 
        currency: "NGN",
        description: "Live calculated delivery rate"
      }]
    });

  } catch (error) {
    console.error("Critical Bridge Error:", error.message);
    return res.status(200).json({ rates: [] });
  }
}