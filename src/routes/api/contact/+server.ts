// Import types from SvelteKit
import type { RequestHandler } from './$types';

// Import Resend (after you: pnpm add resend)
import { Resend } from 'resend';

// Initialize with API key from environment variable
import { RESEND_API_KEY } from '$env/static/private';
const resend = new Resend(RESEND_API_KEY);

// Handle POST requests
export const POST: RequestHandler = async ({ request }) => {
  // 1. Parse the JSON body from the form
  const { name, email, subject, message } = await request.json();

  // 2. Validate (basic example)
    if (!name || !email || !message) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }), 
      { status: 400 }
    );
  }

  // 3. Send email via Resend
  try {
    await resend.emails.send({
      from: 'contact@angelsrest.online',  // Must be verified domain
      to: 'thinkingofview@gmail.com',        // Where you receive it
      subject: subject || `Contact from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      // Optional: use 'html' for formatted emails
          });

    // 4. Return success
    return new Response(
      JSON.stringify({ success: true }), 
      { status: 200 }
    );
  } catch (err) {
    console.error('Resend error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to send' }), 
      { status: 500 }
    );
  }
};