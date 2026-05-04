# My Farms Platform

Responsive farm-to-home e-commerce platform for fresh produce, dairy, meat, oil, customer support, and admin operations.

## Features

### Customer Storefront
- Product catalogue with categories for Fruits, Vegetables, Dairy, Meat, and Oil.
- Product images served from local resources or uploaded/admin-managed image paths.
- Product variants, including variant-specific pricing and stock.
- Product search, category filters, featured products, sorting, and signature product showcase.
- Product preview drawer with image, price, stock, description, variants, and add-to-cart flow.
- Cart with quantity controls and stock-aware add-to-cart behavior.
- Mobile-optimized layout with compact shop controls and a circular Farm Assistant launcher.

### Accounts & Auth
- Customer signup/login with email and password.
- Gmail/Yahoo customer email validation.
- Email verification with 6-digit code before account activation.
- Forgot password and reset password flow.
- Session authentication with Mongo-backed session storage and idle timeout.
- Profile edit with verified email lock and mobile number update.
- Customer account deletion.

### Checkout & Orders
- Protected checkout for logged-in customers.
- Payment methods: `COD` and `PICKUP`.
- Delivery address required for COD orders; pickup uses store pickup address.
- Tip support.
- Promo code validation and discount calculation.
- Tax calculation.
- Wallet coin redemption and order-based coin earning.
- Order persistence in MongoDB.
- Order status history visible in customer account.
- Reorder from previous orders.
- Voice-command order placement includes a visible secondary confirmation step above the checkout modal.

### Wallet & Promotions
- Wallet coins balance and transaction history.
- Earn coins from eligible orders.
- Redeem wallet coins for checkout discount.
- Admin-created promo codes with discount percent, minimum order value, max uses, expiry, active flag, and homepage visibility.
- Live homepage promo carousel.

### Farm Assistant
- Voice commands for product search, add/remove cart items, checkout, order status, wallet, dashboard, profile, complaints, scrolling, and order placement confirmation.
- Gesture mode using MediaPipe Gesture Recognizer.
- Finger cursor for product targeting on screen.
- Hold over product to add to cart.
- Gesture commands for scroll down/up, remove latest cart item, checkout, and selected product add.
- Gesture mode can keep running while the assistant panel is closed; the launcher shows active red status.

### Freshness Lens
- Camera or uploaded-image freshness check.
- Roboflow-backed model inference with endpoint fallback.
- Preferred model: `fruits-fresh-and-rotten-rkl2w/1`.
- Supports serverless/object-detection style Roboflow responses and nested prediction payloads.
- Local visual estimate fallback when model inference is temporarily unavailable.
- Safe diagnostic config endpoint: `/api/freshness/config`.

### Customer Support
- Customers can report order issues by order number.
- Optional proof image upload for complaints.
- Customer complaint history with status, support reply, uploaded proof, and timeline.
- Admin complaint inbox with status filter, reply, and close-ticket flow.
- Complaint creation and closure emails.

### Admin Portal
- Admin login/logout with credentials from environment variables.
- Dashboard KPIs: today's sales, total orders, total sales, low stock count.
- Order trend chart with filters.
- Top products and low-stock product lists.
- Order management with filters by date, status, and category.
- Status updates: `OUT_FOR_DELIVERY`, `ORDER_READY_FOR_PICKUP`, `DELIVERED`, `CANCELED`.
- Customer email notifications for order status updates and cancellations.
- New order alerts in admin UI.
- Product management: create, edit, delete, image upload, descriptions, featured flag, signature showcase flag, stock, and variants.
- Stock control for base products and variant products.
- Promo code management.
- Complaint management.

## Tech

- Node.js + Express
- MongoDB + Mongoose
- React + Vite frontend
- Session auth with `express-session` and `connect-mongo`
- Password hashing with `bcryptjs`
- Email with Nodemailer SMTP or Brevo API
- Image upload with Multer, local resources, and optional Cloudinary
- Roboflow freshness inference
- MediaPipe Gesture Recognizer loaded in-browser for gesture controls
- Render deployment via `render.yaml`

## Run Locally

1. Install dependencies:
   `npm.cmd install`
2. Create `.env` from `.env.example` and configure at least:
   - `MONGO_URI`
   - `SESSION_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
3. Ensure MongoDB is running locally or use MongoDB Atlas.
4. Build frontend:
   `npm.cmd run build:client`
5. Start app:
   `npm.cmd start`
6. Open:
   `http://localhost:3000`

## Frontend Dev

- Run backend API:
  `npm.cmd run dev`
- Run React dev server:
  `npm.cmd run client:dev`
- Open Vite dev app:
  `http://localhost:5173`

The Vite dev server proxies `/api` and `/resources` to `http://localhost:3000`.

## Admin Portal

- Admin page:
  `http://localhost:3000/admin.html`
- Required `.env` values:
  - `ADMIN_EMAIL`
  - `ADMIN_PASSWORD`

## Environment Variables

Core:
- `PORT`
- `MONGO_URI`
- `APP_BASE_URL`
- `SESSION_SECRET`
- `SESSION_IDLE_MS`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `OWNER_EMAIL`

Email:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`
- `BREVO_API_KEY`
- `MAIL_FROM`
- `EMAIL_LOGO_URL`

Uploads:
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Freshness Lens:
- `ROBOFLOW_API_KEY`
- `ROBOFLOW_FRESHNESS_MODEL`
- `ROBOFLOW_API_URL`

Recommended Roboflow values:
```env
ROBOFLOW_FRESHNESS_MODEL=fruits-fresh-and-rotten-rkl2w/1
ROBOFLOW_API_URL=https://serverless.roboflow.com
```

## MongoDB Collections

Use MongoDB Compass with `MONGO_URI`.

Main collections:
- `users`
- `products`
- `orders`
- `promocodes`
- `wallettransactions`
- `complaints`
- `sessions`

## Deployment

Render config is in `render.yaml`.

Build command:
`npm install && npm run build:client`

Start command:
`npm start`

Health check:
`/api/health`

After changing Render environment variables, manually redeploy or wait for auto-deploy.

## Notes

- If no email provider is configured, email content is logged to the server console.
- Forgot-password and email-verification flows return development tokens/codes in API responses when email is not configured.
- Freshness Lens needs `ROBOFLOW_API_KEY`; otherwise it falls back to a local estimate.
- Camera-based features require HTTPS or localhost browser access.
- The server serves the React build from `client/dist` when present; otherwise it falls back to `public/index.html`.
