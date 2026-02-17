# 🚀 BloodBank Deployment Guide

## Deploying to Vercel

This guide will help you deploy your BloodBank application to Vercel with a cloud MySQL database.

## 📋 Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Cloud Database**: You'll need a cloud MySQL database (PlanetScale, Railway, or similar)
3. **Vercel CLI**: Install with `npm i -g vercel`

## 🗄️ Database Setup

### Option 1: PlanetScale (Recommended)
1. Go to [planetscale.com](https://planetscale.com)
2. Create a free account
3. Create a new database
4. Get your connection details

### Option 2: Railway
1. Go to [railway.app](https://railway.app)
2. Create a new project
3. Add MySQL service
4. Get your connection details

### Option 3: Clever Cloud
1. Go to [clever-cloud.com](https://clever-cloud.com)
2. Create a MySQL database
3. Get your connection details

## 🔧 Environment Variables

Set these environment variables in your Vercel project:

```bash
DB_HOST=your-database-host
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_NAME=your-database-name
DB_PORT=3306
NODE_ENV=production
```

## 🚀 Deployment Steps

### 1. Prepare Your Database
```bash
# Run the database setup script locally first
npm run setup
```

### 2. Deploy to Vercel
```bash
# Login to Vercel
vercel login

# Deploy your project
vercel

# Follow the prompts:
# - Set up and deploy: Yes
# - Which scope: Select your account
# - Link to existing project: No
# - Project name: bloodbank-app
# - Directory: ./
```

### 3. Set Environment Variables
```bash
# Set database environment variables
vercel env add DB_HOST
vercel env add DB_USER
vercel env add DB_PASSWORD
vercel env add DB_NAME
vercel env add DB_PORT
vercel env add NODE_ENV
```

### 4. Redeploy with Environment Variables
```bash
vercel --prod
```

## 🌐 Alternative: Deploy Frontend Only

If you want to deploy just the frontend and use a separate backend:

### 1. Create Frontend Build
```bash
# Create a build directory
mkdir build
cp *.html build/
cp *.css build/
cp *.js build/
cp -r Images build/
```

### 2. Update vercel.json for Frontend
```json
{
  "version": 2,
  "builds": [
    {
      "src": "build/**",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/build/$1"
    }
  ]
}
```

## 🔗 Database Connection Examples

### PlanetScale
```bash
DB_HOST=aws.connect.psdb.cloud
DB_USER=your-username
DB_PASSWORD=your-password
DB_NAME=bloodbank_db
DB_PORT=3306
```

### Railway
```bash
DB_HOST=containers-us-west-XX.railway.app
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=railway
DB_PORT=3306
```

## 🛠️ Troubleshooting

### Common Issues:

1. **Database Connection Failed**
   - Check environment variables
   - Ensure database is accessible from Vercel
   - Verify database credentials

2. **Build Errors**
   - Check package.json dependencies
   - Ensure all files are committed
   - Verify Node.js version compatibility

3. **API Routes Not Working**
   - Check vercel.json routing
   - Verify server.js is the main file
   - Check environment variables

### Debug Commands:
```bash
# Check Vercel logs
vercel logs

# Check environment variables
vercel env ls

# Redeploy with debug info
vercel --debug
```

## 📱 Post-Deployment

After successful deployment:

1. **Test the Application**
   - Visit your Vercel URL
   - Test registration and login
   - Verify all features work

2. **Set Up Custom Domain** (Optional)
   - Go to Vercel dashboard
   - Add custom domain
   - Configure DNS settings

3. **Monitor Performance**
   - Check Vercel analytics
   - Monitor database performance
   - Set up error tracking

## 🔒 Security Considerations

1. **Environment Variables**: Never commit sensitive data
2. **Database Security**: Use strong passwords
3. **CORS**: Configure properly for production
4. **HTTPS**: Vercel provides automatic SSL

## 📞 Support

If you encounter issues:
1. Check Vercel documentation
2. Review deployment logs
3. Verify database connectivity
4. Test locally first

---

**Happy Deploying! 🚀**
