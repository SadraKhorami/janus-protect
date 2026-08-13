import type { Metadata } from 'next';
import packageJson from '../../package.json';
import { DocsClient } from './docs-client';
import './docs.css';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'Architecture, setup, protection, licensing, API and deployment documentation.',
};

export default function DocsPage() {
  return <DocsClient version={packageJson.version} />;
}
