require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database setup (simple JSON file for now)
const DB_FILE = path.join(__dirname, 'storage', 'submissions.json');

// Ensure storage directory exists
if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

// Initialize database file if it doesn't exist
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ submissions: [] }, null, 2));
}

// Twilio setup
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
const whatsappNumber = "whatsapp:+14155238886"; // Twilio sandbox

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Helper function to save submission
const saveSubmission = async (data) => {
  const db = JSON.parse(fs.readFileSync(DB_FILE));
  db.submissions.push(data);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  return data;
};

// Helper function to get country name
const getCountryName = (code) => {
  const countries = {
    egypt: "Egypt", burundi: "Burundi", rwanda: "Rwanda",
    kenya: "Kenya", tanzania: "Tanzania", uganda: "Uganda",
    drc: "DR Congo", togo: "Togo", saudi: "Saudi Arabia",
    belgium: "Belgium", france: "France", netherlands: "Netherlands",
    canada: "Canada", usa: "USA"
  };
  return countries[code] || code;
};

// API Endpoints
app.post('/api/submit-transfer', async (req, res) => {
  try {
    const { name, phone, amount, direction, email = '', location = '', country = '', method = '' } = req.body;

    // Validate input
    if (!name || !phone || !amount || !direction) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Prepare submission data
    const submission = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2),
      name,
      phone: phone.startsWith('+') ? phone : `+${phone}`,
      email,
      amount: parseFloat(amount),
      direction,
      location,
      country,
      method,
      status: 'pending',
      timestamp: new Date().toISOString()
    };

    // Save to database
    await saveSubmission(submission);

    // Prepare notification content
    const directionText = direction === 'egypt-out' 
      ? `Egypt to ${getCountryName(country)}` 
      : `${getCountryName(country)} to Egypt`;

    const adminNotification = `
      New Transfer Request (${submission.id})
      ----------------------------
      Name: ${name}
      Phone: ${phone}
      Email: ${email || 'Not provided'}
      Amount: ${amount} ${direction === 'egypt-out' ? 'EGP' : ''}
      Direction: ${directionText}
      ${direction === 'egypt-out' ? 'Pickup Location: ' + location : 'Method: ' + (method || 'Not specified')}
      Date: ${new Date(submission.timestamp).toLocaleString()}
    `;

    const userConfirmation = `
      Dear ${name},

      Thank you for your transfer request with Kabura Multiservice Company.

      Request Details:
      - Reference: ${submission.id}
      - Amount: ${amount} ${direction === 'egypt-out' ? 'EGP' : ''}
      - Direction: ${directionText}
      - Status: Pending

      Our team will contact you shortly to complete the transaction.

      Need help? Call: ${process.env.COMPANY_PHONE || '+1234567890'}
    `;

    // Send notifications (all in parallel)
    await Promise.all([
      // Email to Admin
      transporter.sendMail({
        from: `"KMC Transfers" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `New Transfer: ${name} - ${amount} ${direction === 'egypt-out' ? 'EGP' : ''}`,
        text: adminNotification,
        html: `<pre>${adminNotification}</pre>`
      }),

      // SMS to Admin
      twilioClient.messages.create({
        body: `New KMC Transfer: ${name} - ${amount} ${direction === 'egypt-out' ? 'EGP' : ''} (${submission.id})`,
        from: process.env.TWILIO_PHONE,
        to: process.env.ADMIN_PHONE
      }),

      // WhatsApp to Admin
      twilioClient.messages.create({
        body: adminNotification,
        from: whatsappNumber,
        to: `whatsapp:${process.env.ADMIN_PHONE}`
      }),

      // SMS to User
      twilioClient.messages.create({
        body: `Hi ${name}, your transfer request #${submission.id} for ${amount} received. We'll contact you soon.`,
        from: process.env.TWILIO_PHONE,
        to: submission.phone
      }),

      // Email to User (if email provided)
      email && transporter.sendMail({
        from: `"KMC Support" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your Transfer Request Confirmation',
        text: userConfirmation,
        html: `<pre>${userConfirmation}</pre>`
      })
    ]);

    res.json({ 
      success: true, 
      message: 'Transfer submitted successfully!',
      reference: submission.id
    });

  } catch (error) {
    console.error('Submission error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process transfer request' 
    });
  }
});

// Admin API Endpoints
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, token: process.env.ADMIN_TOKEN });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.get('/api/admin/submissions', (req, res) => {
  try {
    const { authorization } = req.headers;
    if (authorization !== `Bearer ${process.env.ADMIN_TOKEN}`) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const db = JSON.parse(fs.readFileSync(DB_FILE));
    res.json({ success: true, data: db.submissions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch submissions' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});