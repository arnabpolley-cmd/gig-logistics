export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { rate } = req.body;
  const destination = rate.destination;

  try {
    // 1. Get the Lat/Long (You'll need a Geocoding service or GIG's lookup)
    // For now, we assume your GIG API handles the address or you've hardcoded a lookup
    
    // 2. Call the GIG / Agility API
    const response = await fetch("https://dev-thirdpartynode.theagilitysystems.com/price/v3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GIG_API_KEY}` // Securely stored key
      },
      body: JSON.stringify({
        city: destination.city,
        zip: destination.zip,
        weight: rate.items.reduce((sum, item) => sum + item.grams, 0)
      })
    });

    const data = await response.json();

    // 3. Format the response for Shopify
    const shopifyResponse = {
      rates: [{
        service_name: "GIG Logistics Standard",
        service_code: "GIG-STD",
        total_price: (data.price * 100).toString(), // Price in cents
        currency: "NGN"
      }]
    };

    return res.status(200).json(shopifyResponse);
  } catch (error) {
    console.error("Shipping Calculation Error:", error);
    return res.status(200).json({ rates: [] }); // Fallback to no rates
  }
}