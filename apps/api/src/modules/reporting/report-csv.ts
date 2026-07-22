import type { ExportableReportType } from '@ks-os/contracts';

type Column={header:string;value:(row:any)=>unknown};
const columns:Record<ExportableReportType,Column[]>={
  APPOINTMENTS:[['Booking reference','publicReference'],['Start','startTime'],['End','endTime'],['Client','clientDisplayName'],['Service','serviceName'],['Staff','staffName'],['Status','status'],['Channel','bookingChannel'],['Quoted amount (minor units)','quotedAmount'],['Payment state','paymentState'],['Booked at','createdAt']],
  CLIENTS:[['Client reference','clientId'],['Name','name'],['First appointment','firstAppointmentAt'],['Last appointment','lastAppointmentAt'],['Completed appointments','completedAppointmentCount'],['Cancellations','cancelledCount'],['No-shows','noShowCount'],['Recorded spend (minor units)','recordedSpend'],['Future bookings','futureAppointmentCount'],['Client type','clientType']],
  SERVICES:[['Service','serviceName'],['Bookings','bookings'],['Completed','completed'],['Cancelled','cancelled'],['No-shows','noShows'],['Recorded revenue (minor units)','recordedRevenue'],['Average transaction (minor units)','averageRecordedTransaction'],['Unique clients','uniqueClients'],['Rebooking indicator','rebookingIndicator']],
  STAFF_ACTIVITY:[['Staff','staffName'],['Account status','accountStatus'],['Scheduled minutes','scheduledMinutes'],['Booked minutes','bookedMinutes'],['Completed appointments','completedAppointments'],['Cancelled appointments','cancelledAppointments'],['No-shows','noShows'],['Recorded revenue (minor units)','recordedRevenue'],['Unique clients','uniqueClients'],['Utilisation percentage','utilisationPercentage']],
  PRODUCTS:[['Product','name'],['SKU','sku'],['Quantity sold','quantitySold'],['Gross recorded sales (minor units)','grossRecordedSales'],['Transaction count','transactionCount'],['Current stock','currentStock'],['Last sale','lastSaleAt']],
  STOCK:[['Product','name'],['SKU','sku'],['Current quantity','currentQuantity'],['Low stock','lowStock'],['Out of stock','outOfStock'],['Last sale','lastSaleAt']],
  PAYMENTS:[['Date','date'],['Booking reference','bookingReference'],['Client','clientDisplayName'],['Service','serviceName'],['Source','source'],['Method','method'],['Gross amount (minor units)','grossAmount'],['Refunded amount (minor units)','refundedAmount'],['Net amount (minor units)','netAmount'],['Status','status']],
  REFUNDS:[['Booking reference','bookingReference'],['Requested','dateRequested'],['Completed','dateCompleted'],['Amount (minor units)','amount'],['Currency','currency'],['Status','status'],['Reason','reason'],['Source','source'],['Requested by','requestedBy']],
  FORMS:[['Form','formTitle'],['Version','formVersion'],['Client','clientDisplayName'],['Booking reference','appointmentReference'],['Assigned','assignedAt'],['Opened','openedAt'],['Submitted','submittedAt'],['Status','status'],['Assigned by','assignedBy']],
  COMMUNICATIONS:[['Channel','channel'],['Category','category'],['Masked recipient','maskedRecipient'],['Related type','relatedType'],['Queued','queuedAt'],['Sent','sentAt'],['Delivered','deliveredAt'],['Status','status'],['Segments','segmentCount'],['Failure category','failureCategory']],
} as any;
for(const list of Object.values(columns))for(let i=0;i<list.length;i++){const item=list[i] as any;if(Array.isArray(item))list[i]={header:item[0],value:(row:any)=>row[item[1]]};}

export const exportHeaders=(type:ExportableReportType)=>columns[type].map(column=>column.header);
export const exportRow=(type:ExportableReportType,row:unknown)=>columns[type].map(column=>column.value(row));
export function csvCell(value:unknown){let text=value==null?'':String(value);if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
export const csvLine=(values:unknown[])=>`${values.map(csvCell).join(',')}\r\n`;
