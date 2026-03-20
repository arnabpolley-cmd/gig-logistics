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
    
    // Find the active location or the first one in the list
    const primaryLoc = locData.locations?.find(l => l.active) || locData.locations?.[0];

    if (!primaryLoc) {
      console.error("No Shopify locations found via Admin API.");
      return res.status(200).json({ rates: [] });
    }

    // Build Sender String (Optimized for Oshodi/Lagos/PH)
    const sParts = [primaryLoc.address1, primaryLoc.city, primaryLoc.province, "Nigeria"]
      .filter(p => p && p.trim() !== "");
    const sAddrStr = sParts.join(", ");

    const sGeoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(sAddrStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.7" }
    });
    const sGeoData = await sGeoRes.json();

    // --- STEP 2: RECEIVER (Customer Destination) ---
    const dest = rate.destination;
    const rCountry = countryMap[dest.country] || dest.country;

    // Use Address1, City, and Province for the most reliable map match
    const rParts = [dest.address1, dest.city, dest.province, rCountry]
      .filter(p => p && p.trim() !== "");
    const rAddrStr = rParts.join(", ");

    const rGeoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rAddrStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.7" }
    });
    const rGeoData = await rGeoRes.json();

    // --- STEP 3: STRICT VALIDATION (No Fallback) ---
    if (!sGeoData?.[0] || !rGeoData?.[0]) {
      console.warn(`STRICT FAILURE: Map lookup failed. Sender Found: ${!!sGeoData?.[0]}, Receiver Found: ${!!rGeoData?.[0]}`);
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
          "Weight": (i.grams / 1000) || 0.5,
          "IsVolumetric": false,
          "ShipmentType": 1,
          "Value": Math.round(i.price / 100)
        }))
      })
    });

    const gigResult = await gigRes.json();

    if (!gigResult.data || !gigResult.data.GrandTotal) {
      console.error("GIG API: No pricing found for this specific route.");
      return res.status(200).json({ rates: [] });
    }

    // --- STEP 5: FINAL RESPONSE ---
    return res.status(200).json({
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-STRICT-ADMIN-SYNC",
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