/**
 * Test the strict resolution loader
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { printResolutionDiagnostics } from '../../lib/pnl/loadResolutionsStrict';

printResolutionDiagnostics().catch(console.error);
