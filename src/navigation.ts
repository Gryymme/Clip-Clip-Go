export const pages = [
  { name: 'Downloader', icon: 'download', description: 'Inspect one media link and download your selected output.' },
  { name: 'Converter', icon: 'convert', description: 'Convert one local file.' },
  { name: 'Images to PDF', icon: 'images', description: 'Arrange images and create one PDF.' },
  { name: 'Queue', icon: 'queue', description: 'Queue management is not implemented yet.' },
  { name: 'History', icon: 'history', description: 'Conversion history is not implemented yet.' },
  { name: 'Settings', icon: 'settings', description: 'Application preferences are not implemented yet.' },
] as const;
export type PageName = (typeof pages)[number]['name'];
export const isConversionPage = (page: PageName) => page === 'Converter' || page === 'Images to PDF';
