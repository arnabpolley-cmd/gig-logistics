export default async function handler(req, res) {
  console.log("FULL REQUEST FROM SHOPIFY:", JSON.stringify(req.body, null, 2));
  // 1. Method & Security Check
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { rate } = req.body;
  const shopDomain = 's6bcd1-ar.myshopify.com';
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN; 
  const gigToken = process.env.GIG_ACCESS_TOKEN; 
  // Google Maps API Key from environment variable
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;

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

    // Google Maps Geocoding API for Sender
    const sGeoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(sAddrStr)}&key=${googleApiKey}`);
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

    // Google Maps Geocoding API for Receiver
    const rGeoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(rAddrStr)}&key=${googleApiKey}`);
    const rGeoData = await rGeoRes.json();

    // --- STEP 3: GEOCODING VALIDATION ---
    const senderFound = sGeoData.results && sGeoData.results.length > 0;
    const receiverFound = rGeoData.results && rGeoData.results.length > 0;

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
        lat: sGeoData.results[0].geometry.location.lat,
        lon: sGeoData.results[0].geometry.location.lng,
        place_name: sGeoData.results[0].formatted_address
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
        lat: rGeoData.results[0].geometry.location.lat,
        lon: rGeoData.results[0].geometry.location.lng,
        place_name: rGeoData.results[0].formatted_address
      } : "NO RESULTS FOUND"
    });
    // Log shipment items in object format before sending to GIG Logistics API
    console.log("Shipment Items Sent to GIG:");
    rate.items.forEach((i, idx) => {
      console.log({
        ItemName: i.name,
        Quantity: i.quantity,
        Weight: (i.grams / 1000) || 0.5,
        IsVolumetric: false,
        ShipmentType: 1,
        Value: Math.round((i.price * i.quantity) / 100),
        Actual_Value: i.price * i.quantity,
        Description: i.title || i.name
      });
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
          "Weight": (i.grams / 1000), // Converts grams to KG
          "IsVolumetric": false,
          "ShipmentType": 1,
          "Value": i.price * i.quantity,
          "Description": i.title || i.name
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
    console.log("Gig Logistics Result:", {
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-PRECISION-LIVE",
        total_price: (gigResult.data.GrandTotal).toString(), 
        currency: "NGN",
        description: "Live calculated delivery rate"
      }]
    });
    // Use Math.round to ensure no decimals are sent in the string
    const finalPrice = Math.round(parseFloat(gigResult.data.GrandTotal)).toString();
    return res.status(200).json({
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-PRECISION-LIVE",
        total_price: finalPrice, 
        currency: "NGN",
        description: "Live calculated delivery rate"
      }]
    });

  } catch (error) {
    console.error("Critical Bridge Error:", error.message);
    return res.status(200).json({ rates: [] });
  }
}