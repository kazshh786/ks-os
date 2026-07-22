import { Button, Heading, Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export const ScheduledReportReadyEmail=({tenantName,tenantPrimaryColor,reportName,reportType,downloadPageUrl,expiresAt}:any)=>(
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} previewText={`${reportName} is ready`}>
    <Heading as="h2">Your scheduled report is ready</Heading>
    <Text>{reportName} ({String(reportType).replaceAll('_',' ').toLowerCase()}) has finished generating.</Text>
    <Button href={downloadPageUrl} className="rounded bg-black px-4 py-3 text-white">Open secure download</Button>
    <Text>The private export is retained until {new Date(expiresAt).toUTCString()}. You must sign in to the authorised tenant before downloading it.</Text>
    <Text>If you did not expect this report, contact your salon owner or your normal KS OS support contact.</Text>
  </BaseEmailLayout>
);
export default ScheduledReportReadyEmail;
