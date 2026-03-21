export default async function handler(req, res) {
  // 1. Method & Security Check
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { rate } = req.body;
  const shopDomain = 's6bcd1-ar.myshopify.com';
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN; 
  const gigToken = process.env.GIG_ACCESS_TOKEN; 

  try {
    const countryMap = { "NG": "Nigeria" };

    // --- STEP 1: SENDER (Fetching from Shopify Admin Locations) ---
    const locRes = await fetch(`https://${shopDomain}/admin/api/2026-01/locations.json`, {
      headers: { "X-Shopify-Access-Token": adminToken }
    });
    const locData = await locRes.json();
    
    // Finds the active location (e.g., your Oshodi Warehouse)
    const primaryLoc = locData.locations?.find(l => l.active) || locData.locations?.[0];

    if (!primaryLoc) {
      console.error("No Shopify locations found via Admin API.");
      return res.status(200).json({ rates: [] });
    }

    // Build Sender String (Use cleaner address format for better geocoding)
    const cleanAddress1 = primaryLoc.address1?.replace(/^,\s*|\s*,\s*$/g, '').replace(/,\s*,\s*/g, ', ');
    const sParts = [
      cleanAddress1,
      primaryLoc.address2,
      primaryLoc.city,
      primaryLoc.province,
      primaryLoc.zip,
      primaryLoc.country_name
    ].filter(p => p && p.trim() !== "");
    const sAddrStr = sParts.join(", ");

    const sGeoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(sAddrStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.8" }
    });
    const sGeoData = await sGeoRes.json();

    // --- STEP 2: RECEIVER (Customer Destination) ---
    const dest = rate.destination;
    const rCountry = countryMap[dest.country] || dest.country;

    // Use all available address components for better geocoding accuracy
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
        headers: { "User-Agent": "GIGShopifyBridge/1.8" }
    });
    const rGeoData = await rGeoRes.json();

    // --- STEP 3: GEOCODING VALIDATION ---
    const senderFound = sGeoData && sGeoData.length > 0;
    const receiverFound = rGeoData && rGeoData.length > 0;

    // Log detailed sender information
    console.log("=== SENDER DETAILS ===");
    console.log("Original Address1:", primaryLoc.address1);
    console.log("Cleaned Address1:", cleanAddress1);
    console.log("Address Components:", {
      address1: primaryLoc.address1,
      address2: primaryLoc.address2,
      city: primaryLoc.city,
      province: primaryLoc.province,
      zip: primaryLoc.zip,
      country: primaryLoc.country_name
    });
    console.log("Geocoding Query:", sAddrStr);
    console.log("Geocoding Result:", {
      found: senderFound,
      data: sGeoData,
      result: senderFound ? {
        lat: sGeoData[0].lat,
        lon: sGeoData[0].lon,
        display_name: sGeoData[0].display_name
      } : "NO RESULTS FOUND"
    });

    // Log detailed receiver information
    console.log("=== RECEIVER DETAILS ===");
    console.log("Address Components:", {
      address1: dest.address1,
      address2: dest.address2,
      city: dest.city,
      province: dest.province,
      postal_code: dest.postal_code,
      country: rCountry
    });
    console.log("Geocoding Query:", rAddrStr);
    console.log("Geocoding Result:", {
      found: receiverFound,
      data: rGeoData,
      result: receiverFound ? {
        lat: rGeoData[0].lat,
        lon: rGeoData[0].lon,
        display_name: rGeoData[0].display_name
      } : "NO RESULTS FOUND"
    });

    if (!senderFound || !receiverFound) {
      console.error(`Geocoding failed. S:${senderFound} R:${receiverFound}`);
      return res.status(200).json({ rates: [] });
    }

    // --- STEP 4: GIG API CALL (All Items Included) ---
    const gigRes = await fetch("https://dev-thirdpartynode.theagilitysystems.com/price/v3", {
      method: "POST",
      headers: { 
        "access-token": gigToken, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        "VehicleType": 1,
        "ReceiverLocation": { 
          "Latitude": parseFloat(rGeoData[0].lat), 
          "Longitude": parseFloat(rGeoData[0].lon) 
        },
        "SenderLocation": { 
          "Latitude": parseFloat(sGeoData[0].lat), 
          "Longitude": parseFloat(sGeoData[0].lon) 
        },
        "IsPriorityShipment": false,
        "PickUpOptions": 0,
        "ShipmentItems": rate.items.map(i => ({
          "ItemName": i.name,
          "Quantity": i.quantity,
          "Weight": (i.grams / 1000) || 0.5, // Converts grams to KG
          "IsVolumetric": false,
          "ShipmentType": 1,
          "Value": Math.round(i.price / 100) // Converts kobo to Naira
        }))
      })
    });

    const gigResult = await gigRes.json();

    // If GIG API returns an error or no route, return empty rates
    if (!gigResult.data || !gigResult.data.GrandTotal) {
      console.error("GIG API failure:", gigResult);
      return res.status(200).json({ rates: [] });
    }

    // --- STEP 5: FINAL SUCCESS RESPONSE ---
    return res.status(200).json({
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-PRECISION-LIVE",
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