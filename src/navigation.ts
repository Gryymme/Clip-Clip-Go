export const pages = [
  { name: 'Downloader', icon: 'download', description: 'Inspect one media link and download your selected output.' },
  { name: 'Converter', icon: 'convert', description: 'Convert one local file.' },
  { name: 'Images to PDF', icon: 'images', description: 'Arrange images and create one PDF.' },
  { name: 'Merge PDF', icon: 'document', description: 'Combine PDF pages in file order.' },
  { groupStart: true, name: 'Queue', icon: 'queue', description: 'Manage output jobs for this session.' },
  { name: 'History', icon: 'history', description: 'Saved finished job attempts.' },
  { name: 'Settings', icon: 'settings', description: 'Application preferences are not implemented yet.' },
] as const;
export type PageName = (typeof pages)[number]['name'];
export const isConversionPage = (page: PageName) => page === 'Converter' || page === 'Images to PDF' || page === 'Merge PDF';
