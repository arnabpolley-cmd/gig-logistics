export default async function handler(req, res) {
  // Only allow POST requests from Shopify
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { rate } = req.body;
  const shopDomain = 's6bcd1-ar.myshopify.com';
  
  // Credentials from Environment Variables
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN; 
  const gigToken = process.env.GIG_ACCESS_TOKEN; 

  try {
    // 1. GET SENDER (Shopify Location)
    const locRes = await fetch(`https://${shopDomain}/admin/api/2026-01/locations.json`, {
      headers: { "X-Shopify-Access-Token": adminToken }
    });
    const locData = await locRes.json();
    const primaryLoc = locData.locations?.find(l => l.active) || locData.locations?.[0];

    // STRICT CHECK: Does the Store have Latitude/Longitude set?
    const senderLat = parseFloat(primaryLoc?.latitude);
    const senderLon = parseFloat(primaryLoc?.longitude);

    if (!senderLat || !senderLon) {
      console.error("STRICT ERROR: Store location coordinates are missing in Shopify Admin.");
      return res.status(200).json({ rates: [] });
    }

    // 2. GET RECEIVER (Customer Geocoding)
    const dest = rate.destination;
    // We use "Nigeria" instead of "NG" for better Nominatim matching accuracy
    const addressStr = `${dest.address1}, ${dest.city}, Nigeria`;
    
    const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.1 (Internal Logistics)" }
    });
    const geoData = await geoRes.json();

    // STRICT CHECK: Did the geocoder find the customer's address?
    if (!geoData || geoData.length === 0) {
      console.warn("STRICT ERROR: Geocoding failed for customer address:", addressStr);
      return res.status(200).json({ rates: [] });
    }

    const receiverLat = parseFloat(geoData[0].lat);
    const receiverLon = parseFloat(geoData[0].lon);

    // 3. CALL GIG API (Only reached if both sets of coordinates are valid)
    const gigRes = await fetch("https://dev-thirdpartynode.theagilitysystems.com/price/v3", {
      method: "POST",
      headers: { 
        "access-token": gigToken, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        "VehicleType": 1,
        "ReceiverLocation": { 
          "Latitude": receiverLat, 
          "Longitude": receiverLon 
        },
        "SenderLocation": { 
          "Latitude": senderLat, 
          "Longitude": senderLon 
        },
        "IsPriorityShipment": false,
        "PickUpOptions": 0,
        "ShipmentItems": rate.items.map(i => ({
          "ItemName": i.name,
          "Quantity": i.quantity,
          "Weight": (i.grams / 1000) || 0.5, // Defaulting to 0.5kg if 0
          "IsVolumetric": false,
          "ShipmentType": 1,
          "Value": Math.round(i.price / 100)
        }))
      })
    });

    const gigResult = await gigRes.json();
    
    // Safety check for GIG API response structure
    if (!gigResult.data || !gigResult.data.GrandTotal) {
      console.error("GIG API Error or No Route:", JSON.stringify(gigResult));
      return res.status(200).json({ rates: [] });
    }

    const totalAmount = gigResult.data.GrandTotal;

    // 4. RETURN TO SHOPIFY
    return res.status(200).json({
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-DYNAMIC-STRICT",
        total_price: (Math.round(totalAmount * 100)).toString(), 
        currency: "NGN",
        description: "Rate based on exact location coordinates"
      }]
    });

  } catch (error) {
    console.error("Bridge Critical Failure:", error);
    return res.status(200).json({ rates: [] });
  }
}