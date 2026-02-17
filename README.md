# 🩸 BloodBank Full-Stack Application

A comprehensive blood donation management system that connects blood donors directly with recipients, providing an efficient and seamless process for blood emergencies.

## 🌟 **What We Do**

We solve the problem of blood emergencies by connecting blood donors directly with people in blood need, without any intermediary such as blood banks, for an efficient and seamless process.

### 🎯 **Key Features**

- **🔐 User Authentication**: Secure registration and login system
- **📊 Dashboard**: Comprehensive user dashboard with statistics
- **🩸 Blood Requests**: Create and manage blood donation requests
- **💉 Blood Donations**: Schedule and track blood donations
- **📈 Statistics**: Real-time statistics and analytics
- **📱 Inventory Management**: Track blood inventory levels
- **🚨 Emergency Alerts**: Urgent blood request notifications
- **📍 Location-Aware Donor Matching**: Haversine-based nearby donor discovery
- **⚡ Redis Caching**: Fast repeat donor searches with cache fallback
- **📡 Real-Time SSE Alerts**: Instant emergency notifications to nearby donors
- **📞 Contact System**: Integrated contact form for support
- **🌐 Responsive Design**: Works on all devices

## 🚀 **Technology Stack**

### **Frontend**
- HTML5, CSS3, JavaScript (ES6+)
- Responsive design with modern UI/UX
- Font Awesome icons
- Local storage for session management

### **Backend**
- Node.js with Express.js framework
- RESTful API architecture
- MySQL database with mysql2 driver
- bcryptjs for password hashing
- IP-based auth rate limiting middleware
- Redis cache support with in-memory fallback
- Server-Sent Events (SSE) for live emergency alerts
- CORS enabled for cross-origin requests

### **Database**
- MySQL 8.0+
- Connection pooling for performance
- Optimized queries with proper indexing

## 📋 **Prerequisites**

Before running this application, make sure you have the following installed:

- **Node.js** (v14 or higher)
- **MySQL** (v8.0 or higher)
- **npm** (Node Package Manager)

## 🛠️ **Installation & Setup**

### 1. **Clone the Repository**
```bash
git clone <repository-url>
cd BloodBank
```

### 2. **Install Dependencies**
```bash
npm install

# Optional: enable Redis-backed cache (otherwise in-memory cache is used)
npm install redis
```

### 3. **Database Configuration**
Create a `.env` file in the project root:
```bash
cp .env.example .env

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=bloodbank_db
DB_PORT=3306

# Optional (recommended)
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=30
DONOR_SEARCH_CACHE_TTL_SECONDS=120
REDIS_URL=
REDIS_HOST=
REDIS_PORT=6379
```

### 4. **Database Setup**
```bash
npm run setup
```
Run this again after pulling schema updates so geo columns/indexes are added.

### 5. **Start the Application**
```bash
npm start
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **API**: http://localhost:3000/api
- **API Documentation**: http://localhost:3000/api

## 🎮 **How to Use**

### **1. User Registration**
1. Visit http://localhost:3000/register
2. Fill in your details:
   - Name
   - Email
   - Password
   - Blood Group
   - Location (City, State)
3. Click "Create Account"
4. You'll be redirected to the login page

### **2. User Login**
1. Visit http://localhost:3000/login
2. Enter your email and password
3. Click "Login"
4. You'll be redirected to your dashboard

### **3. Dashboard Features**

#### **📊 Statistics Overview**
- **Total Donations**: Number of completed blood donations
- **Blood Requests**: Total blood requests in the system
- **Available Donors**: Number of registered donors
- **Urgent Requests**: Emergency blood requests

#### **🩸 Blood Request Management**
1. Click "Request Blood" button
2. Fill in the form:
   - Patient Name
   - Blood Group Required
   - Units Required
   - Hospital Name
   - Urgency Level (Low/Medium/High/Emergency)
   - Reason
   - Required Date
3. Submit the request

#### **💉 Blood Donation Scheduling**
1. Click "Schedule Donation" button
2. Fill in the form:
   - Donation Date
   - Units to Donate
   - Donation Center
   - Notes
3. Submit the donation schedule

#### **📈 View Inventory**
- Click "View Inventory" to see current blood stock levels
- Shows available and reserved units by blood group

#### **📋 Recent Activities**
- **Recent Blood Requests**: Latest 5 blood requests
- **Recent Donations**: Latest 5 blood donations

### **4. Navigation**
- **Home**: Main landing page
- **Register**: Create new account
- **Login**: Access your account
- **Dashboard**: User dashboard (requires login)
- **Donate**: Blood donation information
- **Contact**: Get help and support

## 🔧 **API Endpoints**

### **Authentication**
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/profile/:id` - Get user profile
- `PUT /api/auth/profile/:id` - Update user profile
- `GET /api/auth/users` - Get all users

### **Blood Requests**
- `POST /api/blood-requests/create` - Create blood request
- `GET /api/blood-requests/all` - Get all requests
- `GET /api/blood-requests/urgent/all` - Get urgent requests
- `GET /api/blood-requests/by-blood-group/:bloodGroup` - Get requests by blood group
- `GET /api/blood-requests/by-location?city=&state=` - Get requests by location
- `PUT /api/blood-requests/:id/status` - Update request status
- `DELETE /api/blood-requests/:id` - Delete request

### **Blood Donations**
- `POST /api/donations/schedule` - Schedule donation
- `PUT /api/donations/:id/complete` - Complete donation
- `GET /api/donations/all` - Get all donations
- `GET /api/donations/statistics` - Get donation statistics
- `GET /api/donations/donor/:donorId` - Get donations by donor
- `GET /api/donations/by-blood-group/:bloodGroup` - Get donations by blood group
- `PUT /api/donations/:id/cancel` - Cancel donation

### **Contact Messages**
- `POST /api/contact/submit` - Submit contact message
- `GET /api/contact/all` - Get all messages
- `GET /api/contact/unread` - Get unread messages
- `GET /api/contact/statistics/overview` - Get message statistics
- `PUT /api/contact/:id/read` - Mark message as read
- `PUT /api/contact/:id/replied` - Mark message as replied
- `DELETE /api/contact/:id` - Delete message

### **Inventory Management**
- `GET /api/inventory/all` - Get all inventory
- `GET /api/inventory/blood-group/:group` - Get inventory by blood group
- `PUT /api/inventory/update` - Update inventory
- `POST /api/inventory/add` - Add units to inventory
- `POST /api/inventory/reserve` - Reserve units
- `POST /api/inventory/release` - Release reserved units
- `GET /api/inventory/low-stock` - Get low stock alerts
- `GET /api/inventory/statistics` - Get inventory statistics

### **Donor Matching**
- `GET /api/matching/nearby-donors` - Geo-match nearby eligible donors
- `GET /api/matching/cache/stats` - Cache hit/miss statistics

### **Live Alerts**
- `GET /api/alerts/stream` - Subscribe to live emergency alerts (SSE)
- `GET /api/alerts/stats` - Active stream connection stats

## 🗄️ **Database Schema**

### **Users Table**
```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  location VARCHAR(100),
  city VARCHAR(50),
  state VARCHAR(50),
  is_donor BOOLEAN DEFAULT FALSE,
  is_recipient BOOLEAN DEFAULT FALSE,
  last_donation_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### **Blood Requests Table**
```sql
CREATE TABLE blood_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  requester_id INT NOT NULL,
  patient_name VARCHAR(100) NOT NULL,
  blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  units_required INT NOT NULL,
  hospital_name VARCHAR(100),
  hospital_address TEXT,
  urgency_level ENUM('Low', 'Medium', 'High', 'Emergency') DEFAULT 'Medium',
  contact_person VARCHAR(100),
  contact_phone VARCHAR(20),
  reason TEXT,
  status ENUM('Pending', 'Approved', 'Completed', 'Cancelled') DEFAULT 'Pending',
  required_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### **Blood Donations Table**
```sql
CREATE TABLE blood_donations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  donor_id INT NOT NULL,
  request_id INT,
  donation_date DATE NOT NULL,
  blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  units_donated INT DEFAULT 1,
  donation_center VARCHAR(100),
  notes TEXT,
  status ENUM('Scheduled', 'Completed', 'Cancelled') DEFAULT 'Scheduled',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES blood_requests(id) ON DELETE SET NULL
);
```

### **Contact Messages Table**
```sql
CREATE TABLE contact_messages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  is_replied BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### **Blood Inventory Table**
```sql
CREATE TABLE blood_inventory (
  id INT PRIMARY KEY AUTO_INCREMENT,
  blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') UNIQUE NOT NULL,
  available_units INT DEFAULT 0,
  reserved_units INT DEFAULT 0,
  total_units INT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## 🎨 **Features Overview**

### **🔐 Authentication System**
- Secure user registration with validation
- Password hashing with bcryptjs
- Session management with localStorage
- Auto-redirect after registration

### **📊 Dashboard Analytics**
- Real-time statistics
- Recent activities tracking
- User profile management
- Quick action buttons

### **🩸 Blood Request Management**
- Create emergency blood requests
- Track request status
- Filter by blood group and location
- Urgency level classification

### **💉 Donation Management**
- Schedule blood donations
- Track donation status
- Donation center management
- Donor statistics

### **📈 Inventory Tracking**
- Real-time blood inventory
- Available and reserved units
- Low stock alerts
- Blood group-wise tracking

### **📞 Contact System**
- Contact form integration
- Message management
- Read/unread status
- Reply tracking

## 🚨 **Emergency Features**

### **Urgent Blood Requests**
- Emergency classification system
- Priority-based request handling
- Real-time notifications
- Quick response mechanisms

### **Blood Buddy Network**
- Community-based approach
- Direct donor-recipient connection
- Automated matching system
- Emergency response coordination

## 💰 **Cost-Free Service**

BloodBank is a non-profit foundation with the ultimate goal of providing:
- Easy-to-use platform
- Easy-to-access services
- Fast and efficient matching
- Reliable blood donation system
- **Totally Free of cost**

## 🤝 **Network Partners**

BloodBank works with several community organizations as a network that responds to emergencies in an efficient manner, providing:
- Automated SMS service
- Mobile app integration
- Emergency response coordination
- Community outreach programs

## 🛡️ **Security Features**

- Password hashing with bcryptjs
- Input validation and sanitization
- SQL injection prevention
- CORS protection
- Error handling and logging

## 📱 **Responsive Design**

The application is fully responsive and works on:
- Desktop computers
- Tablets
- Mobile phones
- All modern browsers

## 🔧 **Development Scripts**

```bash
npm start          # Start the production server
npm run dev        # Start the development server with nodemon
npm run setup      # Setup the database and tables
```

## 📝 **File Structure**

```
BloodBank/
├── config/
│   └── database.js          # Database configuration
├── database/
│   └── schema.sql           # Database schema
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── bloodRequests.js     # Blood request routes
│   ├── donations.js         # Donation routes
│   ├── contact.js           # Contact routes
│   └── inventory.js         # Inventory routes
├── Images/                  # Static images
├── index.html              # Home page
├── login.html              # Login page
├── Register.html           # Registration page
├── dashboard.html          # User dashboard
├── donate.html             # Donation page
├── help.html               # Contact page
├── *.css                   # Stylesheets
├── *.js                    # JavaScript files
├── server.js               # Main server file
├── setup.js                # Database setup script
├── package.json            # Dependencies and scripts
└── README.md               # This file
```

## 🎯 **Mission Statement**

We are a non-profit foundation and our main objective is to make sure that everything is done to protect vulnerable persons. Help us by making a gift!

**BloodBank** - Saving Lives, One Drop at a Time! 🩸❤️

## 📞 **Support**

For any issues or questions:
1. Use the contact form on the website
2. Check the API documentation at `/api`
3. Review the console logs for debugging

---

**Made with ❤️ for saving lives**
