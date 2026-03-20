export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { rate } = req.body;
  const shopDomain = 's6bcd1-ar.myshopify.com';
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN; 
  const gigToken = process.env.GIG_ACCESS_TOKEN; 

  try {
    // 1. DYNAMIC SENDER
    const locRes = await fetch(`https://${shopDomain}/admin/api/2026-01/locations.json`, {
      headers: { "X-Shopify-Access-Token": adminToken }
    });
    const locData = await locRes.json();
    const primaryLoc = locData.locations?.find(l => l.active) || locData.locations?.[0] || {};
    
    // 2. DYNAMIC RECEIVER (Fixed with User-Agent)
    const dest = rate.destination;
    const addressStr = `${dest.address1}, ${dest.city}, ${dest.country}`;
    const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressStr)}&limit=1`, {
        headers: { "User-Agent": "GIGShopifyBridge/1.0" }
    });
    const geoData = await geoRes.json();
    
    // 3. CALL GIG API
    const gigRes = await fetch("https://dev-thirdpartynode.theagilitysystems.com/price/v3", {
      method: "POST",
      headers: { "access-token": gigToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        "VehicleType": 1,
        "ReceiverLocation": { 
          "Latitude": parseFloat(geoData[0]?.lat || 6.4654), 
          "Longitude": parseFloat(geoData[0]?.lon || 3.4064) 
        },
        "SenderLocation": { 
          "Latitude": parseFloat(primaryLoc.latitude || 9.057), 
          "Longitude": parseFloat(primaryLoc.longitude || 7.495) 
        },
        "IsPriorityShipment": false,
        "PickUpOptions": 0,
        "ShipmentItems": rate.items.map(i => ({
          "ItemName": i.name,
          "Quantity": i.quantity,
          "Weight": (i.grams / 1000) || 1,
          "IsVolumetric": false,
          "ShipmentType": 1,
          "Value": i.price / 100
        }))
      })
    });

    const gigResult = await gigRes.json();
    console.log("GIG Result:", JSON.stringify(gigResult)); // Helpful for debugging

    const totalAmount = gigResult.data?.GrandTotal || 0;

    return res.status(200).json({
      rates: [{
        service_name: "GIG Logistics",
        service_code: "GIG-DYNAMIC",
        total_price: (Math.round(totalAmount * 100)).toString(), 
        currency: "NGN",
        description: "Live calculated rate"
      }]
    });

  } catch (error) {
    console.error("Bridge Error:", error);
    return res.status(200).json({ rates: [] });
  }
} 