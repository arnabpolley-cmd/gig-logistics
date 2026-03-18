// export default async function handler(req, res) {
//   if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

//   const { rate } = req.body;
//   const destination = rate.destination;

//   try {
//     // 1. Get the Lat/Long (You'll need a Geocoding service or GIG's lookup)
//     // For now, we assume your GIG API handles the address or you've hardcoded a lookup
    
//     // 2. Call the GIG / Agility API
//     const response = await fetch("https://dev-thirdpartynode.theagilitysystems.com/price/v3", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "Authorization": `Bearer ${process.env.GIG_API_KEY}` // Securely stored key
//       },
//       body: JSON.stringify({
//         city: destination.city,
//         zip: destination.zip,
//         weight: rate.items.reduce((sum, item) => sum + item.grams, 0)
//       })
//     });

//     const data = await response.json();

//     // 3. Format the response for Shopify
//     const shopifyResponse = {
//       rates: [{
//         service_name: "GIG Logistics Standard",
//         service_code: "GIG-STD",
//         total_price: (data.price * 100).toString(), // Price in cents
//         currency: "NGN"
//       }]
//     };

//     return res.status(200).json(shopifyResponse);
//   } catch (error) {
//     console.error("Shipping Calculation Error:", error);
//     return res.status(200).json({ rates: [] }); // Fallback to no rates
//   }
// }


export default async function handler(req, res) {
  // Shopify sends a POST request to this endpoint
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // This logs the data Shopify sends (view this in Vercel 'Logs' tab)
    console.log("Data received from Shopify:", JSON.stringify(req.body));

    /* // --- GIG API CALL (Commented out for testing) ---
    const gigResponse = await fetch("https://dev-thirdpartynode.theagilitysystems.com/price/v3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ... })
    });
    const data = await gigResponse.json();
    */

    // --- STATIC RESPONSE FOR SHOPIFY ---
    // This is the exact format Shopify expects to display rates
    const staticResponse = {
      rates: [
        {
          service_name: "GIG Standard (Test Mode)",
          service_code: "GIG-STD-TEST",
          total_price: "250000", // 2,500.00 in minor units
          description: "Delivery in 3-5 days",
          currency: "NGN"
        },
        {
          service_name: "GIG Express (Test Mode)",
          service_code: "GIG-EXP-TEST",
          total_price: "500000", // 5,000.00 in minor units
          description: "Next day delivery",
          currency: "NGN"
        }
      ]
    };

    // Send the static rates back to Shopify
    return res.status(200).json(staticResponse);

  } catch (error) {
    console.error("Bridge Error:", error);
    // If something fails, return an empty array so checkout doesn't hang
    return res.status(200).json({ rates: [] });
  }
}