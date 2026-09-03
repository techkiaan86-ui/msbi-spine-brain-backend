delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

import prisma from './plugins/db';
import { ga4Service } from './services/ga4.service';
import { google } from 'googleapis';

async function main() {
  console.log('=== STARTING GA4 DATA API REST TEST ===');

  const ga4Record = await prisma.integrationCredential.findUnique({
    where: { platformName: 'ga4' }
  });

  const dbPropertyId = (ga4Record?.config as any)?.propertyId;
  const targetPropertyId = dbPropertyId || process.env.GOOGLE_GA4_PROPERTY_ID || '551466411';
  console.log(`Target Property: properties/${targetPropertyId}`);

  console.log('Fetching Google API Client...');
  const oauth2Client = await (ga4Service as any).getClient();

  console.log('Initializing google.analyticsdata client...');
  const analyticsdata = google.analyticsdata({
    version: 'v1beta',
    auth: oauth2Client
  });

  console.log('Running runReport via REST...');
  try {
    const response = await analyticsdata.properties.runReport({
      property: `properties/${targetPropertyId}`,
      requestBody: {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [],
        metrics: [
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
          { name: 'engagedSessions' }
        ]
      }
    });
    console.log('Report completed successfully!');
    console.log('Response data:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.log('=== REPORT ERROR DETECTED ===');
    console.log('Error Code:', error.code);
    console.log('Error Message:', error.message);
    console.log('Error Details:', JSON.stringify(error, null, 2));
  }
}

main().catch(console.error);
