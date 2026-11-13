import { describe, it, expect } from 'vitest';
import { parseCsv } from '../src/shared/csv';
import { categoryKey, categoryLabel, endpointsFromCsv, guessColumns, readCsv } from '../src/features/probe/lib/probeCsv';

describe('parseCsv', () => {
  it('reads quoted fields, escaped quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n1,2,3\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['1', '2', '3'],
    ]);
  });

  it('skips rows with every field empty, as a spreadsheet leaves them', () => {
    expect(parseCsv('a,b,c\n1,2,3\n,,\n , ,\n"","",""\n4,5,6\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('keeps empty fields and a last row without a trailing newline', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});

// Shaped like the Claude scraper's export: the plain "category" column says Connector on every row,
// "taxonomy_category" is the real category, and the level columns say where it came from.
const HEADER = 'id,name,category,taxonomy_category,object_acted_on,work_department,industry,life_area,endpoint_url';
const csv = [
  HEADER,
  'p1,Google Drive,Connector,files-documents,files-documents; notes-memory,,,,https://drivemcp.googleapis.com/mcp/v1',
  'p2,Figma,Connector,design,,design,,,https://mcp.figma.com/mcp',
  'p3,Shopify | Store,Connector,retail-ecommerce,,,retail-ecommerce,,https://shopify.dev/mcp',
  'p4,No taxonomy,Connector,,,,,,https://example.com/mcp',
  'p5,Salesforce,Connector,,,,,,"user-provided pattern: ^https://api\\.salesforce\\.com/mcp$"',
  'p6,Snowflake,Connector,,,,,,"user-provided: https://snowflakecomputing.com; user-provided: https://*.snowflakecomputing.com"',
  'p7,Empty URL,Connector,,,,,,',
  'p8,Drive again,Connector,files-documents,files-documents,,,,https://drivemcp.googleapis.com/mcp/v1',
  'p9,Two URLs,Connector,,,,,,https://a.example.com/mcp; https://b.example.com/mcp',
].join('\n');

describe('picking endpoints and the taxonomy category from a CSV', () => {
  const table = readCsv(csv)!;

  it('finds the endpoint, name and taxonomy_category columns, and not the plain category column', () => {
    const cols = guessColumns(table.headers);
    expect(table.headers[cols.endpoint]).toBe('endpoint_url');
    expect(table.headers[cols.name]).toBe('name');
    expect(table.headers[cols.category]).toBe('taxonomy_category');
    expect(guessColumns(['Name', 'Category', 'URL']).category).toBe(-1);
  });

  it('takes every fixed http(s) URL once, with the name as label and the category as "level:value"; a connector with several URLs gets the host in each name', () => {
    const r = endpointsFromCsv(table, guessColumns(table.headers));
    expect(r.endpoints).toEqual([
      { url: 'https://drivemcp.googleapis.com/mcp/v1', label: 'Google Drive', category: 'object:files-documents' },
      { url: 'https://mcp.figma.com/mcp', label: 'Figma', category: 'dept:design' },
      { url: 'https://shopify.dev/mcp', label: 'Shopify / Store', category: 'industry:retail-ecommerce' },
      { url: 'https://example.com/mcp', label: 'No taxonomy', category: undefined },
      { url: 'https://a.example.com/mcp', label: 'Two URLs (a.example.com)', category: undefined },
      { url: 'https://b.example.com/mcp', label: 'Two URLs (b.example.com)', category: undefined },
    ]);
    expect(r).toMatchObject({ rows: 9, noUrl: 3, duplicates: 1, withCategory: 3, extraUrls: 0 });
  });

  it('can take only the first URL of each connector, and says how many it left out', () => {
    const r = endpointsFromCsv(table, guessColumns(table.headers), { firstUrlOnly: true });
    expect(r.endpoints).toHaveLength(5);
    expect(r.endpoints[4]).toEqual({ url: 'https://a.example.com/mcp', label: 'Two URLs', category: undefined });
    expect(r.extraUrls).toBe(1);
  });

  it('reads no category when none is chosen', () => {
    const cols = { ...guessColumns(table.headers), category: -1 };
    expect(endpointsFromCsv(table, cols).endpoints.every((e) => e.category === undefined)).toBe(true);
  });

  it('files a value under the first level column that holds it, else under object', () => {
    const h = ['topic', 'industry', 'object acted on'];
    expect(categoryKey('finance', ['finance', 'finance', ''], h)).toBe('industry:finance');
    expect(categoryKey('a; b', ['a; b', '', 'b; a'], h)).toBe('object:a');
    expect(categoryKey('science', ['science'], ['topic'])).toBe('object:science');
    expect(categoryKey('  ', ['  '], ['topic'])).toBe('');
  });

  it('turns a category into a readable label', () => {
    expect(categoryLabel('dept:design')).toBe('Design');
    expect(categoryLabel('object:files-documents')).toBe('Files documents');
    expect(categoryLabel('')).toBe('');
  });

  it('returns nothing without an endpoint column or with a header only', () => {
    expect(endpointsFromCsv(table, { endpoint: -1, name: 1, category: 3 }).endpoints).toEqual([]);
    expect(readCsv('a,b')).toBeNull();
  });
});
