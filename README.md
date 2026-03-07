# My Farms Platform

Responsive end-to-end farm e-commerce web app.

## Features
- Product catalog with categories: Fruits, Vegetables, Dairy, Oil
- Variant selection popup for Mango and Coconut types
- Cart with quantity controls
- Signup/Login with email and password
- Forgot password + reset password flow
- Protected checkout (login required)
- Checkout with payment methods: `COD` and `PICKUP`
- Address required for COD orders
- Order persistence in MongoDB
- Owner email notification on new order (SMTP configurable)
- "My Orders" history for logged-in users

## Tech
- Node.js + Express
- MongoDB + Mongoose
- Session auth (`express-session`)
- Password hashing (`bcryptjs`)
- Email (`nodemailer`)
- React + Vite frontend

## Run
1. Install dependencies:
   `npm.cmd install`
2. Ensure MongoDB is running locally or set Atlas URI in `.env`.
3. Build frontend:
   `npm.cmd run build:client`
4. Start app:
   `npm.cmd start`
5. Open:
   `http://localhost:3000`

## Admin Portal
- Admin page: `http://localhost:3000/admin.html`
- Configure admin credentials in `.env`:
  - `ADMIN_EMAIL`
  - `ADMIN_PASSWORD`
- Admin can update order status to:
  - `OUT_FOR_DELIVERY`
  - `DELIVERED`
- Status updates send email to customer and are visible in customer order history.

## Frontend Dev (React)
- Run backend API: `npm.cmd run dev`
- Run React dev server: `npm.cmd run client:dev`

## MongoDB UI (Easy Data View)
Use **MongoDB Compass**:
1. Open Compass.
2. Connect using URI from `.env` (`MONGO_URI`).
   Example local: `mongodb://127.0.0.1:27017/myfarms`
3. Open collections:
   - `users`
   - `products`
   - `orders`

## Notes
- If SMTP config is missing, email content is logged to server console.
- Forgot-password returns a dev reset token in API response when SMTP is not configured.
