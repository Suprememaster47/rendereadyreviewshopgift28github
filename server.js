/**
 * ---------------------------------------------------------------------
 * MERGED SERVER.JS
 * Main Project (N8N Chatbot + Reviews + Pug + Contact)
 * + AdminJS Secure Dashboard (Analytics Fixes & Independent Session)
 * + Shop Integration (Stripe, Products, Webhooks)
 * + QR Code Redirect System (user-editable via /account)
 * ---------------------------------------------------------------------
 */
import 'dotenv/config';
import path from "path";
import fs from "fs";
import express from "express";
import compression from "compression";
import session from "express-session";
import errorHandler from "errorhandler";
import lusca from "lusca";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import passport from "passport";
import rateLimit from "express-rate-limit";
import axios from "axios";
import { WebSocketServer } from "ws";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import mongoSanitize from "express-mongo-sanitize";

// ── AdminJS imports ──────────────────────────────────────────────────────────
import { AdminJS, ComponentLoader } from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import * as AdminJSMongoose from '@adminjs/mongoose';

AdminJS.registerAdapter(AdminJSMongoose.default || AdminJSMongoose);

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── AdminJS Component Loader ─────────────────────────────────────────────────
const componentLoader = new ComponentLoader();
const Components = {
    Dashboard: componentLoader.add('Dashboard', path.join(__dirname, './components/Dashboard.jsx')),
};

/** --------------------------
 * CONTROLLERS & CONFIG
 * -------------------------- */
const homeController    = require("./controllers/home.cjs");
const userController    = require("./controllers/user.cjs");
const apiController     = require("./controllers/api.cjs");
const aiController      = require("./controllers/ai.cjs");
const contactController = require("./controllers/contact.cjs");
const giftController    = require("./controllers/gift.cjs");

// ── Shop controller ──────────────────────────────────────────────────────────
import * as shopController from './controllers/shop.js';

// ── QR controller ────────────────────────────────────────────────────────────
import { updateDestination, recordScan } from './controllers/qrController.js';

// ── Models ───────────────────────────────────────────────────────────────────
import QRRedirect from './models/QRcoderedirect1.js';
import QRView from './models/QRcodeviews.js';
import UserModel from './models/User.js';
// NEW: Product (for AdminJS resource) + GiftEmail (for Recent Orders dashboard panel)
import ProductModel from './models/Product.js';
import GiftEmail from './models/GiftEmail.js';

const passportConfig = require('./config/passport.cjs');
const { flash }        = require("./config/flash.cjs");
const { morganLogger } = require("./config/morgan.cjs");

/** --------------------------
 * RATE LIMITERS
 * -------------------------- */
const strictLimiter = rateLimit({ 
    windowMs: 60 * 60 * 1000, 
    max: parseInt(process.env.RATE_LIMIT_STRICT, 10) || 5,
    message: { error: "Too many secure requests from this IP. For your security, please try again in an hour." }
});

const loginLimiter = rateLimit({ 
    windowMs: 60 * 60 * 1000, 
    max: parseInt(process.env.RATE_LIMIT_LOGIN, 10) || 10,
    message: { error: "Too many login attempts. Please try again in an hour." }
});

const reviewLimiter = rateLimit({ 
    windowMs: 60 * 60 * 1000, 
    max: parseInt(process.env.RATE_LIMIT_REVIEW, 10) || 20,
    message: { error: "You're submitting reviews a bit too fast! Please take a break and try again later." }
});

const contactFormLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 10,
    message: { error: "Too many messages. Please try again later." }
});

const chatbotLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: "You're chatting a bit too fast! Please wait a few seconds before your next message."
    }
});

const IS_PRODUCTION  = process.env.NODE_ENV === 'production';
const ADMIN_PATH = `/${(process.env.ADMIN_PATH || 'electric-puffin-vault-12').trim().replace(/^\//, '')}`;

/** --------------------------
 * MONGOOSE MODELS
 * -------------------------- */
const reviewSchema = new mongoose.Schema({
    name: String, stars: { type: Number, min: 1, max: 5 }, review_text: String,
    profile_pic: { type: String, default: "https://imgs.search.brave.com/pbruKhRTdtOMZ06961RdlA7ykd9NKAsJilAOtY79yHk/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9wbmdm/cmUuY29tL3dwLWNv/bnRlbnQvdXBsb2Fk/cy8xMDAwMTE3OTc1/LTEtMzAweDI3NS5w/bmc" },
    createdAt: { type: Date, default: Date.now }
});
const Review = mongoose.models.Review || mongoose.model("Review", reviewSchema, "reviews");

const contactSchema = new mongoose.Schema({
    fullName: { type: String, required: true }, email: { type: String, required: false },
    phone: { type: String, required: true }, message: { type: String, required: true },
    messageNumber: { type: Number }, createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.models.Contact || mongoose.model("Contact", contactSchema, "contact");

const responseSchema = new mongoose.Schema({
    sessionId: String, sender: String, message: String, meta: { type: mongoose.Schema.Types.Mixed }, timestamp: { type: Date, default: Date.now }
});
const Response = mongoose.models.Response || mongoose.model('Response', responseSchema);

const alertSchema = new mongoose.Schema({
    ip: String, userAgent: String, pathAttempted: String, timestamp: { type: Date, default: Date.now }
});
const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);

const analyticsSchema = new mongoose.Schema({
    path:      { type: String },
    source:    { type: String, default: 'direct' },
    timestamp: { type: Date,   default: Date.now  },
});
const Analytics = mongoose.models.Analytics || mongoose.model('Analytics', analyticsSchema);

const lastLoggedInSchema = new mongoose.Schema({
    email: String, loginAt: { type: Date, default: Date.now },
});
const LastLoggedIn = mongoose.models.LastLoggedIn || mongoose.model('LastLoggedIn', lastLoggedInSchema, 'lastloggedin');

/** --------------------------
 * HELPER FUNCTIONS
 * -------------------------- */
function detectSource(userAgent = '') {
    const ua = userAgent.toLowerCase();
    if (ua.includes('instagram')) return 'instagram';
    if (ua.includes('tiktok') || ua.includes('musical_ly') || ua.includes('bytedance')) return 'tiktok';
    if (ua.includes('fban') || ua.includes('fbav') || ua.includes('facebook') || ua.includes('[fb')) return 'facebook';
    return 'direct';
}

async function verifyRecaptchaToken(token, remoteip) {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) throw new Error('RECAPTCHA_SECRET_KEY not set');
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);
    if (remoteip) params.append('remoteip', remoteip);
    const resp = await axios.post('https://www.google.com/recaptcha/api/siteverify', params);
    return resp.data;
}

function n8nPost(payload) {
    if (!process.env.N8N_WEBHOOK_URL) throw new Error("N8N_WEBHOOK_URL is not set");
    return axios.post(process.env.N8N_WEBHOOK_URL, payload, {
        headers: { "x-hydro-sweep-auth": process.env.N8N_AUTH_SECRET || "" },
        timeout: 25000
    });
}

const maskName = (name) => {
    if (!name) return "Anonymous";
    const str = String(name).trim();
    if (str.length <= 2) return str;
    return str.substring(0, 2) + "*".repeat(str.length - 2);
};

const ipWhitelist = (req, res, next) => {
    const allowed = (process.env.ALLOWED_IP || '').trim();
    if (!allowed) return next();
    const clientIp = (req.ips && req.ips.length > 0) ? req.ips[0] : (req.ip || '');
    const isLocal  = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(clientIp)
        || clientIp.startsWith('::ffff:127.');
    if (isLocal || clientIp === allowed) return next();
    console.warn(`[AdminJS] Blocked IP: ${clientIp}`);
    res.status(404).send('Not Found');
};

/** --------------------------
 * EXPRESS APP SETUP
 * -------------------------- */
const app = express();
app.set("host", "0.0.0.0");
app.set("port", process.env.PORT || 8080);
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");
app.set("trust proxy", 1);
app.use(morganLogger());
app.use(compression());
app.disable("x-powered-by");

/** --------------------------
 * ADMINJS SETUP
 * -------------------------- */
async function buildAndMountAdminJS() {
    const SESSION_SECRET = (process.env.SESSION_SECRET || 'hydro-sweep-admin-secret-32-chars').trim();
    const ADMIN_EMAIL    = (process.env.ADMIN_EMAIL    || '').trim();
    const ADMIN_PASS     = (process.env.ADMIN_PASSWORD || '').trim();
    const bundleDir      = path.join(__dirname, '.adminjs');

    const adminConfig = {
        resources: [
            {
                resource: UserModel,
                options: {
                    id: 'User',
                    navigation: {
                        name: 'Users',
                        icon: 'User',
                    },
                    properties: {
                        password:               { isVisible: false },
                        tokens:                 { isVisible: false },
                        loginToken:             { isVisible: false },
                        loginExpires:           { isVisible: false },
                        loginIpHash:            { isVisible: false },
                        passwordResetToken:     { isVisible: false },
                        passwordResetExpires:   { isVisible: false },
                        emailVerificationToken: { isVisible: false },
                        _id:   { isTitle: false },
                        email: { isTitle: true },
                    },
                    actions: {
                        delete: { isAccessible: false },
                        edit:   { isAccessible: false },
                        new:    { isAccessible: false },
                    },
                },
            },
            Review,
            Response,
            Contact,
            Alert,
            Analytics,
            LastLoggedIn,
            {
                resource: QRRedirect,
                options: {
                    id: 'QRcoderedirect1',
                    navigation: { name: 'Shop', icon: 'Link' },
                    sort: { sortBy: 'assignmentOrder', direction: 'asc' },
                    // Controls exactly which columns show in the list view, and
                    // in what order — this is what replaces Redirect Delay
                    // Seconds with Assignment Order # at that spot in the table.
                    listProperties: [
                        'route',
                        'product_type',
                        'assignmentOrder',
                        'company_name',
                        'hardcoded_url',
                        'destination_url',
                        'display_message',
                        'active',
                        'ownerId',
                    ],
                    properties: {
                        route:                  { label: 'Route Slug', description: 'The unique route identifier (e.g. review-Tq8wB3). Must be unique.' },
                        product_type:           { label: 'Product Type', description: 'Must EXACTLY match the product_type field on a product listing (e.g. SquareAcrylicSign). Determines which purchases can claim this route.' },
                        assignmentOrder:        { label: 'Assignment Order #', description: 'Set this to control which unassigned route gets claimed next for this product_type. Lower numbers are assigned first (e.g. 1 before 2 before 3). Leave blank to only use this route as a fallback after all numbered routes are used up.' },
                        page_title:             { label: 'Page Title', description: 'The title shown on the interim redirect page' },
                        ownerId:                { label: 'Owner (User ID)', description: 'MongoDB ObjectId of the user who can edit this redirect. Leave blank for admin-only / unassigned. NOTE: clearing this dropdown is unreliable — use the "Unassign Owner" button below instead to guarantee it resets to unassigned.', reference: 'User', isRequired: false },
                        canEdit:                { label: 'Allow User Edits', description: 'If false, the Save button on the user account page is locked.' },
                        hardcoded_url:          { label: 'Hardcoded URL (Locked)', description: 'The short URL printed on the QR code. Never changes.' },
                        destination_url:        { label: 'Destination URL', description: 'Where the scanner is sent after the delay.' },
                        redirect_delay_seconds: { label: 'Redirect Delay (seconds)', description: 'How long the interim page shows before redirecting. 0 = instant.' },
                        active:                 { label: 'Active', description: 'If false, the route returns 404 to scanners.' },
                    },
                    actions: {
                        // Normalizes any edit payload — a defensive backstop in
                        // case the reference select DOES submit an empty
                        // string/undefined value on some clears. This alone
                        // isn't sufficient (see the unassign action below for
                        // the reliable fix), but it doesn't hurt to have it.
                        edit: {
                            before: async (request) => {
                                if (request.payload && Object.prototype.hasOwnProperty.call(request.payload, 'ownerId')) {
                                    const val = request.payload.ownerId;
                                    if (val === '' || val === undefined) {
                                        request.payload.ownerId = null;
                                    }
                                }
                                return request;
                            },
                        },
                        // NEW: guaranteed unassign button, shown on each route's
                        // detail/show page. Sends an explicit ownerId: null
                        // update directly — sidesteps AdminJS's reference-select
                        // clearing behavior entirely, which is what was silently
                        // failing to submit the field at all.
                        unassign: {
                            actionType: 'record',
                            icon: 'CircleOff',
                            label: 'Unassign Owner',
                            guard: 'Are you sure you want to unassign the owner from this route? It will become available for the next purchase to claim.',
                            component: false,
                            handler: async (request, response, context) => {
                                const { record, resource } = context;
                                await resource.update(record.params._id, { ownerId: null });
                                const updatedRecord = await resource.findOne(record.params._id);
                                return {
                                    record: updatedRecord.toJSON(context.currentAdmin),
                                    notice: {
                                        message: 'Owner cleared — route is now unassigned.',
                                        type: 'success',
                                    },
                                };
                            },
                        },
                    },
                },
            },
            {
                resource: QRView,
                options: {
                    id: 'QRcodeviews',
                    navigation: { name: 'Shop', icon: 'BarChart' },
                    properties: {
                        route:     { label: 'Route' },
                        ownerId:   { label: 'Owner (User ID)', reference: 'User' },
                        views:     { label: 'Unique Scan Count' },
                        devices:   { isVisible: false },
                        updatedAt: { label: 'Last Scan At' },
                    },
                    actions: {
                        edit:   { isAccessible: false },
                        delete: { isAccessible: false },
                        new:    { isAccessible: false },
                    },
                },
            },
            {
                resource: ProductModel,
                options: {
                    id: 'Product',
                    navigation: { name: 'Shop', icon: 'ShoppingBag' },
                    properties: {
                        title:        { label: 'Product Title' },
                        product_type: { label: 'Product Type', description: 'Must EXACTLY match the product_type on a QR Redirect route — this is how a purchase gets linked to the right pool of routes.' },
                        slug:         { label: 'URL Slug', description: 'Lowercase, hyphenated, unique (e.g. square-acrylic-sign).' },
                        priceUSD:     { label: 'Price (USD)' },
                        category:     { label: 'Collection / Category', description: 'This exact string becomes a clickable collection filter in the shop UI — type a new one (e.g. "Google Review Signs") to create a new collection automatically.' },
                        sizes:        { label: 'Available Sizes', description: 'One entry per size, e.g. S, M, L. Leave empty if not applicable.' },
                        colors:       { label: 'Available Colors', description: 'One entry per color. Leave empty if not applicable.' },
                        images:       { label: 'Image Paths', description: 'Paths like /assets/images/sign-front.png — first one is the primary product image.' },
                        inStock:      { label: 'In Stock', description: 'If false, the product is hidden from the shop entirely.' },
                        quantityRemaining: {
                            label: 'Quantity Remaining',
                            description: 'How many units are left. Shown on the shop as "X remaining". When this hits 0, the listing shows "Sold Out" and the Add to Cart button is disabled.',
                        },
                        priceTier2Total: {
                            label: 'Buy 2 — Total Price (USD)',
                            description: 'Total price for buying 2 units together (NOT per-unit — e.g. enter 44.99 for "2 for $44.99"). Leave blank for no bundle discount at this tier.',
                        },
                        priceTier3Total: {
                            label: 'Buy 3 — Total Price (USD)',
                            description: 'Total price for buying 3 units together (NOT per-unit). Leave blank for no bundle discount at this tier.',
                        },
                    },
                },
            },
        ],

        rootPath: ADMIN_PATH,
        loginPath: `${ADMIN_PATH}/login`,
        logoutPath: `${ADMIN_PATH}/logout`,
        componentLoader,
        env: { NODE_ENV: process.env.NODE_ENV || 'development' },
        branding: { companyName: 'Hydro Sweep Services', withMadeWithLove: false },
        dashboard: {
            component: Components.Dashboard,
            handler: async () => {
                const now = new Date();

                const startOfToday = new Date(now);
                startOfToday.setHours(0, 0, 0, 0);

                const start7Days = new Date(now);
                start7Days.setDate(now.getDate() - 7);
                start7Days.setHours(0, 0, 0, 0);

                const start30Days = new Date(now);
                start30Days.setDate(now.getDate() - 30);
                start30Days.setHours(0, 0, 0, 0);

                const start24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

                const sourceAggregation = (matchStage) => Analytics.aggregate([
                    { $match: matchStage },
                    { $group: { _id: '$source', count: { $sum: 1 } } },
                ]);

                const pathAggregation = () => Analytics.aggregate([
                    { $group: { _id: '$path', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                ]);

                const recentOrdersAggregation = () => GiftEmail.aggregate([
                    { $unwind: '$orders' },
                    {
                        $project: {
                            _id: 0,
                            email: 1,
                            productType: '$orders.productType',
                            quantity: '$orders.quantity',
                            sessionId: '$orders.sessionId',
                            timestamp: '$orders.timestamp',
                        },
                    },
                    { $sort: { timestamp: -1 } },
                    { $limit: 25 },
                ]);

                const [
                    viewsToday,
                    views7Days,
                    views30Days,
                    viewsAllTime,
                    leadsCount,
                    botAlerts24h,
                    recentContacts,
                    serviceBreakdown,
                    sourcesToday,
                    sources7Days,
                    sources30Days,
                    sourcesAllTime,
                    viewsByPath,
                    lastLogin,
                    qrTotalRoutes,
                    qrActiveRoutes,
                    qrList,
                    recentOrders,
                ] = await Promise.all([
                    Analytics.countDocuments({ timestamp: { $gte: startOfToday } }),
                    Analytics.countDocuments({ timestamp: { $gte: start7Days } }),
                    Analytics.countDocuments({ timestamp: { $gte: start30Days } }),
                    Analytics.countDocuments(),
                    Contact.countDocuments(),
                    Alert.countDocuments({ timestamp: { $gte: start24Hours } }),
                    Contact.find()
                        .sort({ createdAt: -1 })
                        .limit(5)
                        .select('fullName email phone message createdAt')
                        .lean(),
                    Contact.aggregate([
                        { $group: { _id: '$message', count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                    ]),
                    sourceAggregation({ timestamp: { $gte: startOfToday } }),
                    sourceAggregation({ timestamp: { $gte: start7Days } }),
                    sourceAggregation({ timestamp: { $gte: start30Days } }),
                    sourceAggregation({}),
                    pathAggregation(),
                    LastLoggedIn.findOne().sort({ loginAt: -1 }).lean(),
                    QRRedirect.countDocuments(),
                    QRRedirect.countDocuments({ active: true }),
                    QRRedirect.find()
                        .sort({ createdAt: -1 })
                        .limit(10)
                        .select('route company_name destination_url active')
                        .lean(),
                    recentOrdersAggregation(),
                ]);

                const normaliseSources = (arr) => {
                    const map = { instagram: 0, tiktok: 0, facebook: 0, direct: 0 };
                    arr.forEach(({ _id, count }) => { if (_id in map) map[_id] = count; });
                    return map;
                };

                return {
                    viewsToday,
                    views7Days,
                    views30Days,
                    viewsAllTime,
                    leadsCount,
                    botAlerts24h,
                    recentContacts,
                    serviceBreakdown,
                    sourcesToday:   normaliseSources(sourcesToday),
                    sources7Days:   normaliseSources(sources7Days),
                    sources30Days:  normaliseSources(sources30Days),
                    sourcesAllTime: normaliseSources(sourcesAllTime),
                    viewsByPath,
                    lastLogin: lastLogin ? lastLogin.loginAt : null,
                    qrData: {
                        totalRoutes:  qrTotalRoutes,
                        activeRoutes: qrActiveRoutes,
                        list:         qrList,
                    },
                    recentOrders,
                };
            }
        },
    };

    if (IS_PRODUCTION && fs.existsSync(bundleDir)) {
        adminConfig.bundleDir = bundleDir;
        console.log(`📦 AdminJS using pre-built bundle from .adminjs/`);
    }

    const admin = new AdminJS(adminConfig);
    await admin.initialize();

    if (IS_PRODUCTION && fs.existsSync(bundleDir)) {
        app.use(`${ADMIN_PATH}/frontend`, express.static(bundleDir));
        console.log(`📦 AdminJS bundle served from .adminjs/ at ${ADMIN_PATH}/frontend`);
    }

    const cookiePwd = SESSION_SECRET.padEnd(32, '0').substring(0, 32);

    const adminRouter = AdminJSExpress.buildAuthenticatedRouter(admin, {
        authenticate: async (email, password) => {
            if (email?.trim() === ADMIN_EMAIL && password?.trim() === ADMIN_PASS) {
                try {
                    await LastLoggedIn.findOneAndUpdate(
                        {},
                        { email, loginAt: new Date() },
                        { upsert: true, new: true }
                    );
                } catch (e) {
                    console.error('Failed to save last login:', e);
                }
                return { email };
            }
            return null;
        },
        cookieName: 'adminjs-session',
        cookiePassword: cookiePwd,
    }, null, {
        resave: false,
        saveUninitialized: true,
        secret: SESSION_SECRET,
        name: 'adminjs-sid',
        cookie: {
            httpOnly: true,
            sameSite: IS_PRODUCTION ? 'none' : 'lax',
            secure: IS_PRODUCTION,
            maxAge: 86400000,
        },
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    });

    app.use(ADMIN_PATH, ipWhitelist, adminRouter);
    console.log(`✅ AdminJS mounted at ${ADMIN_PATH}`);
}

/** --------------------------
 * MAIN APP INITIALIZATION
 * -------------------------- */
async function startServer() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Mongoose Connected ✅");

    app.post('/webhook', express.raw({ type: 'application/json' }), shopController.stripeWebhookRaw);

    await buildAndMountAdminJS();

    app.use((req, res, next) => {
        if (req.originalUrl.startsWith(ADMIN_PATH)) return next();
        express.json()(req, res, (err) => {
            if (err) return next(err);
            express.urlencoded({ extended: true })(req, res, (err) => {
                if (err) return next(err);
                if (req.body) mongoSanitize.sanitize(req.body);
                if (req.query) mongoSanitize.sanitize(req.query);
                if (req.params) mongoSanitize.sanitize(req.params);
                next();
            });
        });
    });

    app.use(session({
        resave: true,
        saveUninitialized: false,
        secret: process.env.SESSION_SECRET || 'dev-secret',
        name: "startercookie",
        cookie: { maxAge: 1209600000, secure: IS_PRODUCTION },
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    app.use(flash);

    app.use((req, res, next) => {
        if (
            req.originalUrl === "/api/upload" ||
            req.originalUrl === "/ai/togetherai-camera" ||
            req.originalUrl.startsWith("/api/") ||
            req.originalUrl === "/send-to-n8n" ||
            req.originalUrl === "/create-checkout-session" ||
            req.originalUrl === "/webhook" ||
            req.originalUrl === "/gift/search" ||
            req.originalUrl === "/gift/transfer" ||
            req.originalUrl.startsWith(ADMIN_PATH)
        ) return next();
        lusca.csrf()(req, res, next);
    });

    app.use(lusca.xframe("SAMEORIGIN"));
    app.use(lusca.xssProtection(true));

    app.use((req, res, next) => {
        res.locals.user = req.user;
        res.locals.messages = req.flash ? req.flash() : {};
        next();
    });

    app.use("/js/lib", express.static(path.join(__dirname, "node_modules/chart.js/dist")));
    app.locals.GOOGLE_ANALYTICS_ID = process.env.GOOGLE_ANALYTICS_ID || null;

    app.all(['/admin', '/admin/'], async (req, res) => {
        try {
            await Alert.create({ ip: req.ip, userAgent: req.headers['user-agent'], pathAttempted: req.originalUrl });
        } catch (e) {}
        res.status(403).send('Forbidden');
    });

    const trackViews = async (req, res, next) => {
        try {
            if (!req.session.viewTracked) {
                req.session.viewTracked = true;
                await Analytics.create({
                    path:   req.path,
                    source: detectSource(req.headers['user-agent']),
                });
            }
        } catch (e) {
            console.error('Analytics write error:', e.message);
        }
        next();
    };

    app.get("/", trackViews, (req, res) => {
        const indexPath = path.join(__dirname, "public", "index.html");
        fs.readFile(indexPath, 'utf8', (err, data) => {
            if (err) return res.status(500).send("Server Error");
            res.send(data.replace(/<%= RECAPTCHA_SITE_KEY %>|YOUR_RECAPTCHA_SITE_KEY_HERE/g, process.env.RECAPTCHA_SITE_KEY || ''));
        });
    });

    app.get("/home.html",    trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "home.html")));
    app.get("/about.html",   trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "about.html")));
    app.get("/pricing.html", trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "pricing.html")));
    app.get("/contact.html", trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "contact.html")));
    app.get("/shipping-policy", trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "shipping-policy.html")));
    app.get("/privacy-policy", trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "privacy-policy.html")));
    // DMCA content now lives inside the Privacy Policy page (its own
    // section) — this route just redirects anyone with the old link.
    app.get("/dmca", (req, res) => res.redirect(301, '/privacy-policy#dmca'));

    app.use("/", express.static(path.join(__dirname, "public")));

    app.get("/login",   userController.getLogin);
    app.post("/login",  loginLimiter, userController.postLogin);
    app.get("/logout",  userController.logout);
    app.get("/signup",  userController.getSignup);
    app.post("/signup", loginLimiter, userController.postSignup);

    app.get("/account",                  passportConfig.isAuthenticated, userController.getAccount);
    app.post("/account/profile",         passportConfig.isAuthenticated, userController.postUpdateProfile);
    app.post("/account/password",        passportConfig.isAuthenticated, userController.postUpdatePassword);
    app.post("/account/delete",          passportConfig.isAuthenticated, userController.postDeleteAccount);
    app.get("/account/unlink/:provider", passportConfig.isAuthenticated, userController.getOauthUnlink);

    app.put('/dashboard/update-destination', passportConfig.isAuthenticated, updateDestination);

    // ── Gift feature ───────────────────────────────────────────────────────
    app.get('/gift', passportConfig.isAuthenticated, giftController.getGiftPage);
    app.post(
        '/gift/search',
        passportConfig.isAuthenticated,
        giftController.giftSearchLimiter,
        giftController.postGiftSearch
    );
    app.post(
        '/gift/transfer',
        passportConfig.isAuthenticated,
        giftController.giftTransferLimiter,
        giftController.postGiftTransfer
    );

    app.get("/home",     homeController.index);
    app.get("/contact",  strictLimiter, contactController.getContact);
    app.post("/contact", contactController.postContact);
    app.get("/api",      apiController.getApi);
    app.get("/ai",       aiController.getAi);

    app.get('/recaptcha-site-key', (req, res) => res.json({ site_key: process.env.RECAPTCHA_SITE_KEY }));

    // ── NEW: lets the static shop frontend (no Pug/session access) check
    // login state and fetch the profile picture for the nav dropdown.
    app.get('/api/auth-status', (req, res) => {
        res.json({
            loggedIn: !!req.user,
            profilePic: (req.user && req.user.profile && req.user.profile.picture) || null,
        });
    });

    app.post("/api/contact", contactFormLimiter, async (req, res) => {
        try {
            const { fullName, email, phone, message } = req.body;
            if (!fullName || !phone || !message) return res.status(400).json({ success: false, message: "All fields are required." });
            if (fullName.length > 100 || message.length > 500) return res.status(400).json({ success: false, message: "Input too long." });
            const lastContact = await Contact.findOne().sort({ messageNumber: -1 });
            const nextNumber  = (lastContact?.messageNumber) ? lastContact.messageNumber + 1 : 1;
            await new Contact({ fullName, email: email || null, phone, message, messageNumber: nextNumber }).save();
            res.json({ success: true, message: `Message #${nextNumber} saved successfully!`, messageNumber: nextNumber });
        } catch (err) {
            console.error("Contact API Error:", err);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    app.post("/api/submit_review", reviewLimiter, async (req, res) => {
        try {
            const { name, stars, review_text, profile_pic } = req.body;
            const recaptcha_token = req.body['g-recaptcha-response'] || req.body.recaptcha_token;
            if (!name || !stars || !review_text) return res.json({ success: false, message: 'All fields required' });
            if (!recaptcha_token) return res.json({ success: false, message: 'Please complete the CAPTCHA' });
            const verification = await verifyRecaptchaToken(recaptcha_token, req.ip);
            if (!verification.success) return res.json({ success: false, message: 'CAPTCHA failed verification' });
            await new Review({ name, stars: parseInt(stars), review_text, profile_pic: profile_pic || undefined }).save();
            res.json({ success: true, message: "Review saved successfully" });
        } catch (err) {
            console.error(err);
            res.json({ success: false, message: err.message });
        }
    });

    app.get('/api/reviews', async (req, res) => {
        try {
            const page  = parseInt(req.query.page) || 1;
            const limit = 5;
            const totalReviews = await Review.countDocuments();
            const reviews      = await Review.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
            const maskedReviews = reviews.map(r => ({ ...r.toObject(), name: maskName(r.name) }));
            res.json({ reviews: maskedReviews, total_pages: Math.ceil(totalReviews / limit), total_reviews: totalReviews });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/stats', async (req, res) => {
        try {
            const stats = await Review.aggregate([{ $group: { _id: null, avgStars: { $avg: "$stars" }, total: { $sum: 1 } } }]);
            const avgStars     = stats[0]?.avgStars ? parseFloat(stats[0].avgStars.toFixed(1)) : 0;
            const totalReviews = stats[0]?.total || 0;
            res.json({ avgStars, totalReviews });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /** --------------------------
     * CHATBOT MONGO SETUP & ROUTES
     * -------------------------- */
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    let responsesCollection = null;

    try {
        await mongoClient.connect();
        responsesCollection = mongoClient.db("test").collection("responses");
        await responsesCollection.createIndex({ sessionId: 1, timestamp: -1 });
        console.log("Chatbot Mongo Connected ✅");
    } catch (error) {
        console.error("Chatbot Mongo Error:", error);
    }

    async function saveMessage({ sessionId, sender, message, meta = {} }) {
        if (!responsesCollection) return;
        await responsesCollection.insertOne({ sessionId, sender, message, meta, timestamp: new Date() });
    }

    app.post("/send-to-n8n", chatbotLimiter, async (req, res) => {
        const { message, sessionId } = req.body;
        if (!message) return res.status(400).json({ error: "No message" });
        try {
            await saveMessage({ sessionId, sender: "user", message });
            const resp  = await n8nPost({ message, sessionId });
            const reply = typeof resp.data === "string" ? resp.data : resp.data.reply || JSON.stringify(resp.data);
            await saveMessage({ sessionId, sender: "bot", message: reply });
            res.json({ reply });
        } catch (err) {
            console.error("n8n HTTP error:", err.message);
            if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
                return res.status(503).json({ error: "The assistant is waking up, please try again in a moment." });
            }
            res.status(500).json({ error: "n8n error" });
        }
    });

    /** --------------------------
     * SHOP ROUTES
     * -------------------------- */
    app.get(['/shop', '/shop/collections', '/shop/collections/:slug'], shopController.getShopPage);
    app.get('/shop/status', shopController.getShopStatusPage);
    app.get('/api/products',          shopController.getProducts);
    app.get('/api/products/:slug',    shopController.getProductBySlug);
    app.get('/api/sold-counts',       shopController.getSoldCounts);
    app.get('/api/sold-counts/:slug', shopController.getSoldCountBySlug);
    app.post('/create-checkout-session', shopController.createCheckoutSession);
    app.get('/api/verify-session',       shopController.verifySession);

    /** --------------------------
     * QR CODE CATCH-ALL REDIRECT
     * MUST be last GET route before the 404 handler.
     * -------------------------- */
    app.get('/:route', async (req, res, next) => {
        const { route } = req.params;
        if (
            route.startsWith('admin') ||
            route.startsWith('api') ||
            route.startsWith('shop') ||
            route.startsWith('account') ||
            route.startsWith('auth') ||
            route.startsWith('gift') ||
            route.includes('.')
        ) return next();

        try {
            const qrRoute = await QRRedirect.findOne({ route, active: true }).lean();
            if (!qrRoute) return next();

            recordScan(
              route,
              qrRoute.ownerId,
              req.ip,
              req.headers['user-agent'] || ''
            );

            let dest = qrRoute.destination_url;
            if (!dest.startsWith('http')) dest = 'https://' + dest;

            const delay = parseInt(qrRoute.redirect_delay_seconds ?? 3, 10);
            if (delay <= 0) return res.redirect(dest);

            return res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${qrRoute.page_title || 'Redirecting to ' + (qrRoute.company_name || 'us')}...</title>
    <style>
      body { margin:0;padding:0;display:flex;justify-content:center;align-items:center;height:100vh;font-family:'Segoe UI',Arial,sans-serif;background:#f8f9fa;color:#333; }
      .card { background:white;padding:40px;border-radius:20px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.1);max-width:400px;width:90%;background-image:url('https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg');background-repeat:no-repeat;background-position:top 20px center;background-size:50px;padding-top:80px;text-decoration:none;color:inherit;display:block;transition:transform 0.2s ease-in-out,box-shadow 0.2s ease-in-out; }
      a.card:hover { transform:scale(1.02);box-shadow:0 15px 35px rgba(0,0,0,0.15);cursor:pointer; }
      h1 { font-size:1.5rem;margin-bottom:10px; }
      .message { font-size:1.1rem;color:#666;margin-bottom:20px; }
      .redirect-text { font-size:1.1rem;display:flex;justify-content:center;align-items:center;gap:6px; }
      .timer-container { display:inline-flex;justify-content:center;align-items:center;width:1.2rem;height:1.5rem; }
      .timer { font-weight:800;color:#1a73e8; }
      .manual-link { font-size:0.85rem;color:#aaa;margin-top:5px;display:none;border-top:1px solid #eee;padding-top:10px; }
      @keyframes fadeInDown { 0%{opacity:0;transform:translateY(-5px);}100%{opacity:1;transform:translateY(0);} }
      .animate-fade { animation:fadeInDown 0.4s ease-out; }
      .dots::after { content:'';animation:dots 1.5s infinite; }
      @keyframes dots { 0%{content:'';}33%{content:'.';}66%{content:'..';}100%{content:'...';} }
    </style>
  </head>
  <body>
    <a href="${dest}" class="card">
      <h1>${qrRoute.page_title || 'We appreciate your feedback'}</h1>
      <p class="message">${qrRoute.display_message || 'Thanks for scanning.'}</p>
      <div id="countdown-area">
        <div class="redirect-text">Redirecting in <span class="timer-container"><span class="timer" id="count">${delay}</span></span> seconds<span style="width:1.5rem;text-align:left;"><span class="dots"></span></span></div>
      </div>
      <div id="manual-link" class="manual-link">Click to go to Review Page</div>
    </a>
    <script>
      let c=${delay};
      const timer=document.getElementById('count');
      const ca=document.getElementById('countdown-area');
      const ml=document.getElementById('manual-link');
      const iv=setInterval(()=>{c--;if(c>0){timer.textContent=c;timer.classList.remove('animate-fade');void timer.offsetWidth;timer.classList.add('animate-fade');}else{clearInterval(iv);ca.style.display='none';ml.style.display='block';}},1000);
      setTimeout(()=>{window.location.href='${dest}';},${delay*1000});
    </script>
  </body>
</html>`);
        } catch (err) {
            console.error('[QR Redirect] Error:', err.message);
            return next();
        }
    });

    app.use((req, res) => res.status(404).send("Page Not Found"));
    if (!IS_PRODUCTION) app.use(errorHandler());

    const server = app.listen(app.get("port"), () => {
        console.log(`🚀 Server running at http://localhost:${app.get("port")}`);
        console.log(`🛡️  Admin panel → http://localhost:${app.get("port")}${ADMIN_PATH}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        shopController.verifyEmailConnection();
        console.log(`    Shop checkout   : ${shopController.STRIPE_READY  ? '✅  ready' : '⚠️  dev mode (Stripe keys missing)'}`);
        console.log(`    Shop webhooks   : ${shopController.WEBHOOK_READY ? '✅  ready' : '⚠️  disabled (STRIPE_WEBHOOK_SECRET not set)'}`);
        console.log(`    Shop email      : ${shopController.EMAIL_READY   ? '✅  configured' : '⚠️  not configured (EMAIL_* vars missing)'}`);
    });

    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => {
        ws.on("message", async (raw) => {
            try {
                const { message, sessionId } = JSON.parse(raw.toString());
                await saveMessage({ sessionId, sender: "user", message });
                const resp  = await n8nPost({ message, sessionId });
                const reply = typeof resp.data === "string" ? resp.data : resp.data.reply || JSON.stringify(resp.data);
                await saveMessage({ sessionId, sender: "bot", message: reply });
                ws.send(JSON.stringify({ reply, sessionId }));
            } catch (err) {
                console.error("WebSocket n8n error:", err.message);
                if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
                    ws.send(JSON.stringify({ reply: "The assistant is waking up, please try again in a moment." }));
                } else {
                    ws.send(JSON.stringify({ error: "WS Error" }));
                }
            }
        });
    });

    process.on("SIGINT", async () => {
        await mongoose.disconnect();
        server.close(() => process.exit(0));
    });
}

startServer();

export default app;