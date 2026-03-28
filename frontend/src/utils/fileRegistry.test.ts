// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Project Structure Regression: Web Worker Absence', () => {
    it('ensures svgProcessWorker.ts has been removed', () => {
        const workerPath = path.resolve(__dirname, 'svgProcessWorker.ts');
        expect(fs.existsSync(workerPath)).toBe(false);
    });

    it('ensures svgWorkerClient.ts has been removed', () => {
        const clientPath = path.resolve(__dirname, 'svgWorkerClient.ts');
        expect(fs.existsSync(clientPath)).toBe(false);
    });
});
