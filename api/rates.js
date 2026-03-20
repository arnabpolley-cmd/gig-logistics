export default async function handler(req, res) {
  // 1. Security & Method Check
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { rate } = req.body;
  const shopDomain = 's6bcd1-ar.myshopify.com';
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN; 
  const gigToken = process.env.GIG_ACCESS_TOKEN; 

  try {
    // --- STEP 1: DYNAMIC SENDER (Your Store) ---
    const locRes = await fetch(`https://${shopDomain}/admin/api/2026-01/locations.json`, {
      headers: { "X-Shopify-Access-Token": adminToken }
    });
    const locData = await locRes.json();
    const primaryLoc = locData.locations?.find(l => l.active) || locData.locations?.[0];

    if (!primaryLoc) {
      console.error("No Shopify locations found.");
      return res.status(200).json({ rates: [] });
    }

    // Build Precise Sender String for Nominatim
    const sParts = [
      primaryLoc.address1, 
      primaryLoc.city, 
      primaryLoc.province, 
      primaryLoc.zip, 
      primaryLoc.country_name
    ].filter(p => p && p.trim() !== "");
    const sAddrStr = sParts.join(", ");

    const sGeoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(sAddrStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.2" }
    });
    const sGeoData = await sGeoRes.json();

    // --- STEP 2: DYNAMIC RECEIVER (The Customer) ---
    const dest = rate.destination;
    
    // Map Country Code to Full Name for better accuracy
    const countryMap = { "NG": "Nigeria" };
    const countryName = countryMap[dest.country] || dest.country;

    const rParts = [
      dest.address1, 
      dest.address2, 
      dest.city, 
      dest.province, 
      dest.postal_code, 
      countryName
    ].filter(p => p && p.trim() !== "");
    const rAddrStr = rParts.join(", ");

    const rGeoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rAddrStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.2" }
    });
    const rGeoData = await rGeoRes.json();

    // --- STEP 3: LOGIC CHECK & FALLBACK ---
    const senderFound = sGeoData && sGeoData.length > 0;
    const receiverFound = rGeoData && rGeoData.length > 0;

    if (!senderFound || !receiverFound) {
      console.warn(`Geocoding failed. S:${senderFound} R:${receiverFound}. Using Fallback.`);
      
      // If map fails, return a safe Flat Rate so the customer can still buy
      return res.status(200).json({
        rates: [{
          service_name: "GIG Logistics (Standard Delivery)",
          service_code: "GIG-STD-FALLBACK",
          total_price: "650000", // ₦6,500 Flat Rate
          currency: "NGN",
          description: "Calculated based on regional shipping zones"
        }]
      });
    }

    // --- STEP 4: GIG API CALL (Only if Lat/Long exists) ---
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
          "Weight": (i.grams / 1000) || 0.5,
          "IsVolumetric": false,
          "ShipmentType": 1,
          "Value": Math.round(i.price / 100)
        }))
      })
    });

    const gigResult = await gigRes.json();

    if (!gigResult.data || !gigResult.data.GrandTotal) {
      console.error("GIG API returned no data:", JSON.stringify(gigResult));
      return res.status(200).json({ rates: [] });
    }

    // --- STEP 5: FINAL RESPONSE TO SHOPIFY ---
    return res.status(200).json({
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-DYNAMIC-PRECISE",
        total_price: (Math.round(gigResult.data.GrandTotal * 100)).toString(), 
        currency: "NGN",
        description: "Live calculated rate based on exact location"
      }]
    });

  } catch (error) {
    console.error("Bridge Critical Failure:", error);
    // Return empty so Shopify knows the bridge is down but doesn't crash the checkout
    return res.status(200).json({ rates: [] });
  }
}