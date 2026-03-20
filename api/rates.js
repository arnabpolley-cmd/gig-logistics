export default async function handler(req, res) {
  // 1. Method Guard
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { rate } = req.body;
  const gigToken = process.env.GIG_ACCESS_TOKEN; 

  try {
    const countryMap = { "NG": "Nigeria" };

    // --- STEP 1: DYNAMIC SENDER (From Shopify Origin) ---
    const origin = rate.origin; 
    const sCountry = countryMap[origin.country] || origin.country;

    const sParts = [
      origin.address1, 
      origin.city, 
      origin.province, 
      origin.postal_code, 
      sCountry
    ].filter(p => p && p.trim() !== "");
    const sAddrStr = sParts.join(", ");

    const sGeoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(sAddrStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.4" }
    });
    const sGeoData = await sGeoRes.json();

    // --- STEP 2: DYNAMIC RECEIVER (From Shopify Destination) ---
    const dest = rate.destination;
    const rCountry = countryMap[dest.country] || dest.country;

    const rParts = [
      dest.address1, 
      dest.address2, 
      dest.city, 
      dest.province, 
      dest.postal_code, 
      rCountry
    ].filter(p => p && p.trim() !== "");
    const rAddrStr = rParts.join(", ");

    const rGeoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rAddrStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.4" }
    });
    const rGeoData = await rGeoRes.json();

    // --- STEP 3: STRICT COORDINATE VALIDATION ---
    // If either location is not found on the map, return blank rates (Stops Checkout)
    if (!sGeoData?.[0] || !rGeoData?.[0]) {
      console.warn(`STRICT FAILURE: Map could not locate address. S: ${sAddrStr} | R: ${rAddrStr}`);
      return res.status(200).json({ rates: [] });
    }

    const sLat = parseFloat(sGeoData[0].lat);
    const sLon = parseFloat(sGeoData[0].lon);
    const rLat = parseFloat(rGeoData[0].lat);
    const rLon = parseFloat(rGeoData[0].lon);

    // --- STEP 4: GIG API CALL ---
    const gigRes = await fetch("https://dev-thirdpartynode.theagilitysystems.com/price/v3", {
      method: "POST",
      headers: { "access-token": gigToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        "VehicleType": 1,
        "ReceiverLocation": { "Latitude": rLat, "Longitude": rLon },
        "SenderLocation": { "Latitude": sLat, "Longitude": sLon },
        "IsPriorityShipment": false,
        "PickUpOptions": 0,
        "ShipmentItems": rate.items.map(i => ({
          "ItemName": i.name,
          "Quantity": i.quantity,
          "Weight": (i.grams / 1000) || 0.5,
          "IsVolumetric": false,
          "ShipmentType": 1,
          "Value": Math.round(i.price / 100)
        }))
      })
    });

    const gigResult = await gigRes.json();

    // If GIG returns an error or no route exists
    if (!gigResult.data || !gigResult.data.GrandTotal) {
      console.error("GIG API No Route Found:", JSON.stringify(gigResult));
      return res.status(200).json({ rates: [] });
    }

    // --- STEP 5: FINAL RESPONSE TO SHOPIFY ---
    return res.status(200).json({
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-PRECISION-ONLY",
        total_price: (Math.round(gigResult.data.GrandTotal * 100)).toString(), 
        currency: "NGN",
        description: "Verified direct shipping rate"
      }]
    });

  } catch (error) {
    console.error("Bridge Critical Error:", error);
    return res.status(200).json({ rates: [] });
  }
}