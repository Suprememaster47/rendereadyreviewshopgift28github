/**
 * controllers/shop.js
 */

import path            from 'path';
import { fileURLToPath } from 'url';
import nodemailer      from 'nodemailer';
import Stripe          from 'stripe';
import Product         from '../models/Product.js';
import Mapping         from '../models/Mapping.js';
import Sold            from '../models/Sold.js';
import ProcessedOrder  from '../models/ProcessedOrder.js';
import QRRedirect      from '../models/QRcoderedirect1.js';
import GiftEmail       from '../models/GiftEmail.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function hasValue(key) {
  const v = process.env[key];
  if (!v || v.trim() === '') return false;
  if (v.startsWith('sk_test_XXXX')) return false;
  if (v.startsWith('pk_test_XXXX')) return false;
  if (v.startsWith('whsec_XXXX'))   return false;
  return true;
}

function sanitizeImagePaths(product) {
  if (!product) return null;
  return {
    ...product,
    images: Array.isArray(product.images)
      ? product.images.map(img =>
          typeof img === 'string' && img.startsWith('/public')
            ? img.replace('/public', '')
            : img
        )
      : product.images,
  };
}

/**
 * NEW: computes the total charge for a given quantity of a product,
 * honoring bundle/tier pricing set in AdminJS. Never trusts a client-
 * supplied price — always derives it fresh from the product document.
 *
 * qty 1 -> priceUSD
 * qty 2 -> priceTier2Total (or priceUSD * 2 if not set)
 * qty 3 -> priceTier3Total (or priceUSD * 3 if not set)
 * qty 4+ -> linear priceUSD * qty (no tier defined beyond 3)
 */
function computeTierTotal(product, qty) {
  if (qty === 1) return product.priceUSD;
  if (qty === 2) return typeof product.priceTier2Total === 'number' ? product.priceTier2Total : product.priceUSD * 2;
  if (qty === 3) return typeof product.priceTier3Total === 'number' ? product.priceTier3Total : product.priceUSD * 3;
  return product.priceUSD * qty;
}

export const STRIPE_READY  = hasValue('STRIPE_SECRET_KEY') && hasValue('STRIPE_PUBLISHABLE_KEY');
export const WEBHOOK_READY = STRIPE_READY && hasValue('STRIPE_WEBHOOK_SECRET');

if (!STRIPE_READY) {
  console.warn('\n⚠️  [Shop] Stripe keys not configured — checkout runs in DEV mode.');
  console.warn('   Add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to .env\n');
} else if (!WEBHOOK_READY) {
  console.warn('\n⚠️  [Shop] STRIPE_WEBHOOK_SECRET not set — webhook verification disabled.');
  console.warn('   Checkout and payments work normally without it.\n');
}

const stripe = STRIPE_READY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export const EMAIL_READY =
  hasValue('EMAIL_HOST') &&
  hasValue('EMAIL_PORT') &&
  hasValue('EMAIL_USER') &&
  hasValue('EMAIL_PASS');

if (!EMAIL_READY) {
  console.warn('\n⚠️  [Shop] Email not configured — order confirmation emails disabled.');
  console.warn('   Add EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS to .env\n');
}

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST || 'mail.privateemail.com',
  port:   parseInt(process.env.EMAIL_PORT || '465', 10),
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout:   10000,
  socketTimeout:     15000,
});

export function verifyEmailConnection() {
  if (EMAIL_READY) {
    transporter.verify()
      .then(() => console.log('    Email (SMTP)    : ✅  connected (Namecheap Private Email)'))
      .catch(err => {
        console.warn('    Email (SMTP)    : ⚠️  connection failed —', err.message);
        console.warn('                       Check EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS in .env');
      });
  } else {
    console.log('    Email (SMTP)    : ⚠️  not configured (EMAIL_* vars missing)');
  }
}

function centsToUSD(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function formatEmailDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch (_) {
    return isoString;
  }
}

function buildOrderEmailHTML({ customerName, customerEmail, sessionId, transactionDate, receiptItems, amountTotal }) {
  const shopUrl  = 'https://hydrosweepservices.com/shop/collections';
  const dateStr  = formatEmailDate(transactionDate);
  const totalStr = centsToUSD(amountTotal);
  const nameStr  = customerName || customerEmail || 'Valued Customer';

  const itemRows = (receiptItems || []).map(item => {
    const desc = item.description ? `<br><span style="color:#888; font-size:12px;">${item.description}</span>` : '';
    const qty  = item.quantity > 1 ? ` &times; ${item.quantity}` : '';
    return `
      <tr>
        <td style="padding:10px 0; border-bottom:1px solid #2a2a2a; font-size:14px; color:#ddd;">
          ${item.name}${qty}${desc}
        </td>
        <td style="padding:10px 0; border-bottom:1px solid #2a2a2a; font-size:14px;
                   color:#ddd; text-align:right; white-space:nowrap;">
          ${centsToUSD(item.totalAmount)}
        </td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmation — Hydro Sweep Services</title>
</head>
<body style="margin:0; padding:0; background:#0a0a0a; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; color:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#0a0a0a; padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px; background:#111;
               border:1px solid #2a2a2a; border-radius:16px; overflow:hidden;">
          <tr>
            <td style="background:#000; padding:28px 36px; border-bottom:1px solid #222; text-align:center;">
              <p style="margin:0; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#666;">Hydro Sweep Services</p>
              <h1 style="margin:8px 0 0; font-size:22px; font-weight:800; letter-spacing:-0.5px; color:#fff;">Order Confirmed</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 20px; font-size:15px; color:#ccc; line-height:1.6;">
                Hi ${nameStr},<br><br>
                Thank you for your purchase! Your payment has been confirmed and your
                order is currently being processed and prepared for shipment.
              </p>
              <hr style="border:none; border-top:1px solid #2a2a2a; margin:0 0 24px;">
              <p style="margin:0 0 12px; font-size:10px; font-weight:800; letter-spacing:2px; text-transform:uppercase; color:#555;">Order Details</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${itemRows || `<tr><td style="padding:10px 0; font-size:14px; color:#888;">No item details available.</td></tr>`}
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:6px 0; font-size:13px; color:#888;">Subtotal</td>
                  <td style="padding:6px 0; font-size:13px; color:#888; text-align:right;">${totalStr}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; font-size:13px; color:#888;">Shipping</td>
                  <td style="padding:6px 0; font-size:13px; color:#888; text-align:right;">Free</td>
                </tr>
                <tr>
                  <td style="padding:14px 0 6px; font-size:15px; font-weight:800; color:#fff; border-top:1px solid #2a2a2a;">Total Paid</td>
                  <td style="padding:14px 0 6px; font-size:15px; font-weight:800; color:#fff; text-align:right; border-top:1px solid #2a2a2a;">${totalStr}</td>
                </tr>
              </table>
              <hr style="border:none; border-top:1px solid #2a2a2a; margin:24px 0;">
              <p style="margin:0 0 12px; font-size:10px; font-weight:800; letter-spacing:2px; text-transform:uppercase; color:#555;">Reference Information</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
                <tr>
                  <td style="padding:4px 0; color:#666; width:40%;">Order Number</td>
                  <td style="padding:4px 0; color:#bbb; word-break:break-all;">${sessionId || '—'}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0; color:#666;">Transaction Date</td>
                  <td style="padding:4px 0; color:#bbb;">${dateStr}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0; color:#666;">Payment Status</td>
                  <td style="padding:4px 0; color:#4caf76; font-weight:700;">Confirmed</td>
                </tr>
                <tr>
                  <td style="padding:4px 0; color:#666;">Confirmation Sent To</td>
                  <td style="padding:4px 0; color:#bbb;">${customerEmail || '—'}</td>
                </tr>
              </table>
              <hr style="border:none; border-top:1px solid #2a2a2a; margin:28px 0 24px;">
              <div style="text-align:center;">
                <a href="${shopUrl}"
                   style="display:inline-block; background:#ffffff; color:#000000;
                          font-size:13px; font-weight:800; text-transform:uppercase;
                          letter-spacing:1px; text-decoration:none;
                          padding:14px 36px; border-radius:40px;">
                  Continue Shopping
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px; border-top:1px solid #1a1a1a; text-align:center;">
              <p style="margin:0; font-size:11px; color:#444; line-height:1.6;">
                This email was sent by Hydro Sweep Services.<br>
                If you have questions about your order, please contact us at
                <a href="mailto:info@hydrosweepservices.com" style="color:#666; text-decoration:none;">info@hydrosweepservices.com</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendOrderEmail(opts) {
  if (!EMAIL_READY) {
    console.warn('📧  [Shop] Email not configured — skipping order confirmation email.');
    return;
  }
  const { customerEmail, customerName, sessionId, transactionDate, receiptItems, amountTotal } = opts;
  if (!customerEmail) {
    console.warn('📧  [Shop] No customer email on session — skipping confirmation email.');
    return;
  }
  const shortOrder = sessionId ? sessionId.slice(-8) : 'ORDER';
  try {
    const info = await transporter.sendMail({
      from:    '"Hydro Sweep Services" <info@hydrosweepservices.com>',
      to:      customerEmail,
      subject: `Your Order Confirmation — Hydro Sweep Services (#${shortOrder})`,
      html:    buildOrderEmailHTML({ customerName, customerEmail, sessionId, transactionDate, receiptItems, amountTotal }),
      text: [
        'ORDER CONFIRMATION — HYDRO SWEEP SERVICES',
        '==========================================',
        '',
        `Hi ${customerName || customerEmail},`,
        '',
        'Thank you for your purchase! Your payment has been confirmed.',
        '',
        'ORDER DETAILS',
        '-------------',
        ...(receiptItems || []).map(i =>
          `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ''}: ${centsToUSD(i.totalAmount)}` +
          (i.description ? `\n  ${i.description}` : '')
        ),
        '',
        `Total Paid: ${centsToUSD(amountTotal)}`,
        'Shipping:   Free',
        '',
        'REFERENCE',
        '---------',
        `Order Number:     ${sessionId || '—'}`,
        `Transaction Date: ${formatEmailDate(transactionDate)}`,
        `Payment Status:   Confirmed`,
        '',
        'Questions? Email us at info@hydrosweepservices.com',
        '',
        'Hydro Sweep Services',
      ].join('\n'),
    });
    console.log(`📧  Order confirmation sent to ${customerEmail} (messageId: ${info.messageId})`);
  } catch (err) {
    console.error('📧  Failed to send order confirmation email:', err.message);
  }
}

async function assignRoutesForPurchase(email, purchasedItems, sessionId = null) {
  const summary = { assigned: [], shortfalls: [] };

  if (!email || !Array.isArray(purchasedItems) || purchasedItems.length === 0) {
    console.warn('[Shop] assignRoutesForPurchase called with missing email or items — skipping.');
    return summary;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const giftRecord = await GiftEmail.findOne({ email: normalizedEmail })
    .select('ownerId email -_id')
    .lean();

  if (!giftRecord || !giftRecord.ownerId) {
    console.warn(`[Shop] No GiftEmail record (or missing ownerId) for ${normalizedEmail} — cannot auto-assign routes. Manual assignment needed.`);
    summary.shortfalls.push({ reason: 'no_giftemail_record', email: normalizedEmail, items: purchasedItems });
    return summary;
  }

  const ownerId = giftRecord.ownerId;

  const orderEntries = purchasedItems
    .filter(item => item.product_type)
    .map(item => ({
      productType: item.product_type,
      quantity:    Math.max(1, parseInt(item.quantity, 10) || 1),
      sessionId:   sessionId || null,
      timestamp:   new Date(),
    }));

  if (orderEntries.length > 0) {
    try {
      await GiftEmail.updateOne(
        { email: normalizedEmail },
        { $push: { orders: { $each: orderEntries } } }
      );
      console.log(`📝  [Shop] Logged ${orderEntries.length} order entr${orderEntries.length === 1 ? 'y' : 'ies'} to GiftEmail for ${normalizedEmail}`);
    } catch (err) {
      console.error('[Shop] Failed to log order history to GiftEmail:', err.message);
    }
  }

  const UNASSIGNED_OWNER_FILTER = { $in: [null, ''] };

  for (const item of purchasedItems) {
    const productType = item.product_type;
    const quantity    = Math.max(1, parseInt(item.quantity, 10) || 1);

    if (!productType) continue;

    for (let i = 0; i < quantity; i++) {
      try {
        let claimedRoute = await QRRedirect.findOneAndUpdate(
          { product_type: productType, ownerId: UNASSIGNED_OWNER_FILTER, active: true, assignmentOrder: { $ne: null } },
          { $set: { ownerId } },
          { new: true, sort: { assignmentOrder: 1 } }
        );

        if (!claimedRoute) {
          claimedRoute = await QRRedirect.findOneAndUpdate(
            { product_type: productType, ownerId: UNASSIGNED_OWNER_FILTER, active: true },
            { $set: { ownerId } },
            { new: true }
          );
        }

        if (claimedRoute) {
          summary.assigned.push({ route: claimedRoute.route, product_type: productType, ownerId });
          console.log(`✅  [Shop] Assigned route "${claimedRoute.route}" (order: ${claimedRoute.assignmentOrder ?? 'unnumbered/fallback'}) (${productType}) to ${normalizedEmail} (ownerId: ${ownerId})`);
        } else {
          console.warn(`⚠️  [Shop] No unassigned route available for product_type "${productType}" — inventory of routes is empty (or already claimed). Purchase: ${normalizedEmail}`);
          summary.shortfalls.push({ reason: 'no_available_route', product_type: productType, email: normalizedEmail });
        }
      } catch (err) {
        console.error(`❌  [Shop] Error assigning route for product_type "${productType}":`, err.message);
        summary.shortfalls.push({ reason: 'error', product_type: productType, email: normalizedEmail, error: err.message });
      }
    }
  }

  return summary;
}

const RESTRICTED_PRODUCT_TYPES = new Set(['SquareAcrylicSign']);

async function enforceRegisteredEmailRestriction({ customerEmail, purchasedItems, paymentIntentId, sessionId }) {
  const hasRestrictedItem = Array.isArray(purchasedItems)
    && purchasedItems.some(item => RESTRICTED_PRODUCT_TYPES.has(item.product_type));

  if (!hasRestrictedItem) return true;

  if (!customerEmail) {
    console.warn(`[Shop] Order ${sessionId} has a restricted product_type but no customer email on session — treating as invalid.`);
  } else {
    const normalizedEmail = customerEmail.trim().toLowerCase();
    const giftRecord = await GiftEmail.findOne({ email: normalizedEmail }).select('_id').lean();
    if (giftRecord) return true;
  }

  console.warn(`[Shop] Order ${sessionId}: checkout email "${customerEmail}" not found in GiftEmail for a restricted product_type — refunding.`);

  if (STRIPE_READY && paymentIntentId) {
    try {
      await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
      });
      console.log(`💸  [Shop] Refund issued for session ${sessionId} (payment_intent: ${paymentIntentId})`);
    } catch (err) {
      console.error(`❌  [Shop] Failed to issue refund for session ${sessionId}:`, err.message);
    }
  } else {
    console.warn(`[Shop] Cannot issue refund for ${sessionId} — Stripe not ready or missing payment_intent.`);
  }

  sendOrderCancellationEmail({ customerEmail, sessionId });

  return false;
}

function buildCancellationEmailHTML({ customerEmail, sessionId }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Order Cancelled — Hydro Sweep Services</title></head>
<body style="margin:0; padding:0; background:#0a0a0a; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; color:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a; padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px; background:#111; border:1px solid #2a2a2a; border-radius:16px; overflow:hidden;">
          <tr>
            <td style="background:#000; padding:28px 36px; border-bottom:1px solid #222; text-align:center;">
              <p style="margin:0; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#666;">Hydro Sweep Services</p>
              <h1 style="margin:8px 0 0; font-size:22px; font-weight:800; letter-spacing:-0.5px; color:#fff;">Order Cancelled &amp; Refunded</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 16px; font-size:15px; color:#ccc; line-height:1.6;">
                We were unable to process your recent order because the email used at
                checkout doesn't match a registered account on our site. Your payment
                has been automatically refunded in full — no further action is needed
                on your part for the refund.
              </p>
              <p style="margin:0 0 16px; font-size:15px; color:#ccc; line-height:1.6;">
                This product requires checking out with the same email address as
                your registered account. Please create an account (or sign in) with
                <strong>${customerEmail}</strong>, then complete your purchase again
                using that same email at checkout.
              </p>
              <p style="margin:24px 0 0; font-size:12px; color:#666;">
                Reference: ${sessionId || '—'}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px; border-top:1px solid #1a1a1a; text-align:center;">
              <p style="margin:0; font-size:11px; color:#444; line-height:1.6;">
                Questions? Contact us at
                <a href="mailto:info@hydrosweepservices.com" style="color:#666; text-decoration:none;">info@hydrosweepservices.com</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendOrderCancellationEmail({ customerEmail, sessionId }) {
  if (!EMAIL_READY || !customerEmail) {
    console.warn('📧  [Shop] Skipping cancellation email — email not configured or no customer email.');
    return;
  }
  try {
    const info = await transporter.sendMail({
      from:    '"Hydro Sweep Services" <info@hydrosweepservices.com>',
      to:      customerEmail,
      subject: 'Your order was cancelled and refunded — Hydro Sweep Services',
      html:    buildCancellationEmailHTML({ customerEmail, sessionId }),
      text: [
        'ORDER CANCELLED & REFUNDED — HYDRO SWEEP SERVICES',
        '==================================================',
        '',
        `We were unable to process your recent order because the email used at`,
        `checkout (${customerEmail}) doesn't match a registered account. Your`,
        `payment has been automatically refunded in full.`,
        '',
        'Please create an account (or sign in) with this email address, then',
        'complete your purchase again using that same email at checkout.',
        '',
        `Reference: ${sessionId || '—'}`,
        '',
        'Questions? Email us at info@hydrosweepservices.com',
      ].join('\n'),
    });
    console.log(`📧  Cancellation notice sent to ${customerEmail} (messageId: ${info.messageId})`);
  } catch (err) {
    console.error('📧  Failed to send cancellation email:', err.message);
  }
}

const SHIPPING_COUNTRIES = [
  'US', 'CA', 'MX', 'GB', 'IE', 'AU', 'NZ',
  'AT', 'BE', 'CH', 'DE', 'DK', 'ES', 'FI', 'FR', 'IT', 'LU', 'NL', 'NO', 'PT', 'SE',
  'BG', 'CY', 'CZ', 'EE', 'GR', 'HR', 'HU', 'LT', 'LV', 'MT', 'PL', 'RO', 'SI', 'SK',
  'AL', 'BA', 'IS', 'LI', 'ME', 'MK', 'RS', 'TR',
  'JP', 'KR', 'SG', 'HK', 'TW', 'IN', 'PH', 'TH', 'MY', 'ID', 'VN',
  'AE', 'SA', 'IL', 'QA', 'KW', 'BH',
  'ZA', 'NG', 'KE', 'GH', 'EG', 'MA',
  'BR', 'AR', 'CL', 'CO', 'PE', 'UY',
];

export function getShopPage(req, res) {
  if (req.params.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(req.params.slug)) {
    return res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'shop.html'));
}

export function getShopStatusPage(_req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'shop-status.html'));
}

export async function getProducts(_req, res) {
  try {
    const products = await Product.find({ inStock: true }).select('-__v').lean();
    res.json(products.map(p => sanitizeImagePaths(p)));
  } catch (err) {
    console.error('GET /api/products error:', err.message);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
}

export async function getProductBySlug(req, res) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(req.params.slug)) {
    return res.status(400).json({ error: 'Invalid slug format' });
  }
  try {
    const fullPath   = `/shop/collections/${req.params.slug}`;
    const mappingDoc = await Mapping.findById('69da9a93602cdd03a9098d9f').lean();
    if (!mappingDoc || !mappingDoc[fullPath]) {
      return res.status(404).json({ error: 'Route mapping not found for this slug' });
    }
    const product = await Product.findOne({ title: mappingDoc[fullPath] }).select('-__v').lean();
    if (!product) return res.status(404).json({ error: 'Product not found in database' });
    res.json(sanitizeImagePaths(product));
  } catch (err) {
    console.error('GET /api/products/:slug error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSoldCounts(_req, res) {
  try {
    const counts = await Sold.find({}).select('slug units_sold -_id').lean();
    const map = {};
    counts.forEach(c => { map[c.slug] = c.units_sold; });
    res.json(map);
  } catch (err) {
    console.error('GET /api/sold-counts error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sold counts' });
  }
}

export async function getSoldCountBySlug(req, res) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(req.params.slug)) {
    return res.status(400).json({ error: 'Invalid slug format' });
  }
  try {
    const record = await Sold.findOne({ slug: req.params.slug }).lean();
    res.json({ slug: req.params.slug, units_sold: record ? record.units_sold : 0 });
  } catch (err) {
    console.error('GET /api/sold-counts/:slug error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sold count' });
  }
}

/**
 * POST /create-checkout-session
 * Body: { items: [{ slug, selectedSize, selectedColor, quantity }] }
 *
 * `quantity` here now represents the BUNDLE TIER the shopper picked on the
 * PDP (1, 2, or 3) — computeTierTotal() looks up the correct total price
 * for that quantity directly from the product document (never from the
 * client) and divides it back out to a per-unit unit_amount for Stripe,
 * since Stripe line items are priced per-unit × quantity.
 */
export async function createCheckoutSession(req, res) {
  if (!STRIPE_READY) {
    return res.json({ dev: true, message: 'Stripe not configured.' });
  }

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  if (items.length > 50) {
    return res.status(400).json({ error: 'Cart exceeds maximum item limit' });
  }
  for (const item of items) {
    if (typeof item.slug !== 'string' || !item.slug.trim()) {
      return res.status(400).json({ error: 'Each item must have a valid slug' });
    }
    if (typeof item.quantity !== 'number' || item.quantity < 1 || item.quantity > 99) {
      return res.status(400).json({ error: 'Item quantity must be between 1 and 99' });
    }
  }

  try {
    const slugs      = [...new Set(items.map(i => i.slug.trim().toLowerCase()))];
    const dbProducts = await Product.find({ slug: { $in: slugs }, inStock: true })
      .select('slug title priceUSD priceTier2Total priceTier3Total images product_type')
      .lean();

    const productMap = {};
    dbProducts.forEach(p => { productMap[p.slug] = p; });

    const lineItems = [];
    const purchasedByType = {};

    for (const item of items) {
      const dbProduct = productMap[item.slug.trim().toLowerCase()];
      if (!dbProduct) {
        return res.status(400).json({ error: `Product not found or out of stock: ${item.slug}` });
      }

      const qty = item.quantity || 1;
      const cleanProduct   = sanitizeImagePaths(dbProduct);
      const firstImage     = cleanProduct.images[0] || '';
      const stripeImageUrl = firstImage.startsWith('http')
        ? firstImage
        : firstImage ? `${process.env.BASE_URL}${firstImage}` : null;

      const descParts = [
        item.selectedSize  && item.selectedSize  !== 'NA' ? `Size: ${item.selectedSize}`  : null,
        item.selectedColor && item.selectedColor !== 'NA' ? `Color: ${item.selectedColor}` : null,
        qty > 1 ? `Bundle of ${qty}` : null,
      ].filter(Boolean);

      const tierTotal  = computeTierTotal(dbProduct, qty);
      const unitAmount = Math.round((tierTotal / qty) * 100);

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name:        dbProduct.title,
            images:      stripeImageUrl ? [stripeImageUrl] : [],
            description: descParts.join(' | ') || undefined,
          },
          unit_amount: unitAmount,
        },
        quantity: qty,
      });

      if (dbProduct.product_type) {
        purchasedByType[dbProduct.product_type] =
          (purchasedByType[dbProduct.product_type] || 0) + qty;
      }
    }

    const purchasedItemsMetadata = Object.entries(purchasedByType).map(([product_type, quantity]) => ({
      product_type,
      quantity,
    }));

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items:  lineItems,
      mode:        'payment',
      billing_address_collection:  'required',
      shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
      success_url: `${process.env.BASE_URL}/shop/status?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.BASE_URL}/shop/status?status=cancel`,
      metadata: {
        purchased_items: JSON.stringify(purchasedItemsMetadata),
      },
    });

    res.json({ url: checkoutSession.url });
  } catch (err) {
    console.error('[Shop] Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed' });
  }
}

export async function verifySession(req, res) {
  if (!STRIPE_READY) {
    return res.json({ status: 'dev', message: 'Stripe not configured' });
  }

  const { session_id } = req.query;
  if (!session_id || typeof session_id !== 'string') {
    return res.json({ status: 'cancelled' });
  }
  if (!session_id.startsWith('cs_')) {
    return res.status(400).json({ status: 'error', message: 'Invalid session ID format' });
  }

  try {
    const stripeSession = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items.data.price.product'],
    });

    if (stripeSession.payment_status !== 'paid') {
      return res.json({
        status:        stripeSession.payment_status,
        customerEmail: stripeSession.customer_details?.email || null,
      });
    }

    const alreadyProcessed = await ProcessedOrder.findOne({ session_id }).lean();

    if (alreadyProcessed?.cancelled) {
      return res.json({
        status:  'cancelled_refunded',
        message: 'This order was cancelled and refunded because the checkout email is not associated with a registered account.',
        customerEmail: stripeSession.customer_details?.email || null,
      });
    }

    let cancelledThisRequest = false;

    if (!alreadyProcessed) {
      await ProcessedOrder.create({ session_id });

      const customerEmailForAssignment = stripeSession.customer_details?.email || null;
      const purchasedItemsRaw = stripeSession.metadata?.purchased_items;
      let purchasedItems = [];
      if (purchasedItemsRaw) {
        try { purchasedItems = JSON.parse(purchasedItemsRaw); } catch (e) {
          console.error('[Shop] verify-session: failed to parse purchased_items metadata:', e.message);
        }
      }

      const emailCheckPassed = await enforceRegisteredEmailRestriction({
        customerEmail:    customerEmailForAssignment,
        purchasedItems,
        paymentIntentId:  stripeSession.payment_intent,
        sessionId:        session_id,
      });

      if (!emailCheckPassed) {
        cancelledThisRequest = true;
        await ProcessedOrder.updateOne(
          { session_id },
          { $set: { cancelled: true, cancelReason: 'checkout_email_not_registered' } }
        );
      } else {
        const stripeLineItems = stripeSession.line_items?.data || [];

        for (const lineItem of stripeLineItems) {
          const productName = lineItem.price?.product?.name || lineItem.description || '';
          const quantity    = lineItem.quantity || 1;

          if (productName) {
            const product = await Product.findOne({ title: productName }).select('slug').lean();
            if (product) {
              await Sold.findOneAndUpdate(
                { slug: product.slug },
                {
                  $inc:         { units_sold: quantity },
                  $setOnInsert: { name: productName },
                },
                { upsert: true, new: true }
              );
              console.log(`📦  [Shop] Sold count updated: ${product.slug} +${quantity}`);

              try {
                const updatedProduct = await Product.findOneAndUpdate(
                  { slug: product.slug },
                  [
                    {
                      $set: {
                        quantityRemaining: {
                          $max: [
                            { $subtract: [{ $ifNull: ['$quantityRemaining', 0] }, quantity] },
                            0,
                          ],
                        },
                      },
                    },
                  ],
                  { new: true }
                );
                if (updatedProduct) {
                  console.log(`📉  [Shop] quantityRemaining updated: ${product.slug} -${quantity} → ${updatedProduct.quantityRemaining} remaining`);
                }
              } catch (invErr) {
                console.error(`[Shop] Failed to decrement quantityRemaining for ${product.slug}:`, invErr.message);
              }
            }
          }
        }

        if (customerEmailForAssignment && purchasedItemsRaw) {
          try {
            const assignSummary = await assignRoutesForPurchase(customerEmailForAssignment, purchasedItems, session_id);
            console.log(`[Shop] verify-session route assignment summary for ${customerEmailForAssignment}:`, JSON.stringify(assignSummary));
          } catch (assignErr) {
            console.error('[Shop] verify-session route assignment error:', assignErr.message);
          }
        } else {
          console.warn('[Shop] verify-session: missing customer email or purchased_items metadata — skipping route assignment.');
        }

        const receiptItemsForEmail = stripeLineItems.map(li => ({
          name:        li.price?.product?.name        || li.description || 'Item',
          description: li.price?.product?.description || '',
          quantity:    li.quantity || 1,
          unitAmount:  li.price?.unit_amount || 0,
          totalAmount: li.amount_total       || 0,
        }));

        sendOrderEmail({
          customerEmail:   stripeSession.customer_details?.email || null,
          customerName:    stripeSession.customer_details?.name  || null,
          sessionId:       session_id,
          transactionDate: new Date(stripeSession.created * 1000).toISOString(),
          receiptItems:    receiptItemsForEmail,
          amountTotal:     stripeSession.amount_total,
        });
      }
    }

    if (cancelledThisRequest) {
      return res.json({
        status:  'cancelled_refunded',
        message: 'This order was cancelled and refunded because the checkout email is not associated with a registered account.',
        customerEmail: stripeSession.customer_details?.email || null,
      });
    }

    const receiptItems = (stripeSession.line_items?.data || []).map(li => ({
      name:        li.price?.product?.name        || li.description || 'Item',
      description: li.price?.product?.description || '',
      imageUrl:    li.price?.product?.images?.[0] || null,
      quantity:    li.quantity || 1,
      unitAmount:  li.price?.unit_amount || 0,
      totalAmount: li.amount_total       || 0,
    }));

    res.json({
      status:          'paid',
      customerEmail:   stripeSession.customer_details?.email || null,
      customerName:    stripeSession.customer_details?.name  || null,
      amountTotal:     stripeSession.amount_total,
      shippingAddress: stripeSession.shipping_details?.address || null,
      lineItems:       receiptItems,
      transactionDate: new Date(stripeSession.created * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[Shop] Verify session error:', err.message);
    res.status(400).json({ status: 'error', message: 'Could not verify session' });
  }
}

export async function stripeWebhookRaw(req, res) {
  if (!WEBHOOK_READY) {
    console.warn('[Shop] Webhook received but STRIPE_WEBHOOK_SECRET not configured — ignoring.');
    return res.status(503).json({ error: 'Webhook secret not configured' });
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Shop] Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('✅  [Shop] Payment confirmed via webhook:', session.id);

    (async () => {
      try {
        const alreadyProcessed = await ProcessedOrder.findOne({ session_id: session.id }).lean();
        if (alreadyProcessed) {
          console.log(`[Shop] Webhook: session ${session.id} already processed (cancelled: ${!!alreadyProcessed.cancelled}) — skipping duplicate work.`);
          return;
        }

        await ProcessedOrder.create({ session_id: session.id });

        const customerEmail = session.customer_details?.email || session.customer_email || null;
        const purchasedItemsRaw = session.metadata?.purchased_items;

        let purchasedItems = [];
        if (purchasedItemsRaw) {
          try { purchasedItems = JSON.parse(purchasedItemsRaw); } catch (parseErr) {
            console.error('[Shop] Webhook: failed to parse purchased_items metadata:', parseErr.message);
          }
        }

        const emailCheckPassed = await enforceRegisteredEmailRestriction({
          customerEmail,
          purchasedItems,
          paymentIntentId: session.payment_intent,
          sessionId: session.id,
        });

        if (!emailCheckPassed) {
          await ProcessedOrder.updateOne(
            { session_id: session.id },
            { $set: { cancelled: true, cancelReason: 'checkout_email_not_registered' } }
          );
          console.warn(`[Shop] Webhook: order ${session.id} cancelled + refunded — skipping route assignment.`);
          return;
        }

        if (!customerEmail) {
          console.warn('[Shop] Webhook: no customer email on session — cannot assign routes.', session.id);
          return;
        }
        if (!purchasedItemsRaw) {
          console.warn('[Shop] Webhook: no purchased_items metadata on session — cannot assign routes.', session.id);
          return;
        }

        const summary = await assignRoutesForPurchase(customerEmail, purchasedItems, session.id);
        console.log(`[Shop] Webhook route assignment summary for ${customerEmail}:`, JSON.stringify(summary));
      } catch (err) {
        console.error('[Shop] Webhook route assignment error:', err.message);
      }
    })();
  }

  res.json({ received: true });
}