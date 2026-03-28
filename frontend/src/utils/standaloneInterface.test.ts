// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to extract a function from a script block in a file
const extractFunction = (filePath: string, functionName: string) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    // More specific regex that looks for the function end pattern
    const regex = new RegExp(`const\\s+${functionName}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*({.*?return\\s*\\[...targets\\];\\s*})`, 's');
    const match = content.match(regex);
    if (!match) return null;
    
    // Create the function by evaluating it in the current scope
    return new Function(match[1], match[2]);
};

describe('standalone_interface.html extraction logic', () => {
    const filePath = path.resolve(__dirname, '../../../standalone_interface.html');
    const getActionTargetVoltageLevels = extractFunction(filePath, 'getActionTargetVoltageLevels');

    if (!getActionTargetVoltageLevels) {
        it.skip('Could not extract getActionTargetVoltageLevels function from standalone_interface.html', () => {});
        return;
    }

    const makeNodeMap = (...ids: string[]) => {
        const map = new Map();
        ids.forEach(id => map.set(id, { equipmentId: id, svgId: `svg-${id}` }));
        return map;
    };

    it('extracts VL with spaces from description without quotes', () => {
        const detail = {
            description_unitaire: "Ouverture MQIS P7_MQIS 7COUPL DJ_OC dans le poste MQIS P7",
            action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {}, pst_tap: {} }
        };

        const result = getActionTargetVoltageLevels(detail, null, makeNodeMap('MQIS P7'));
        expect(result).toEqual(['MQIS P7']);
    });

    it('extracts VL from mid-ID segment with spaces', () => {
        const detail = {
            description_unitaire: 'No description available',
            action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {}, pst_tap: {} }
        };

        const actionId = 'de829050-177c-4244-ba94-61b22d2684a4_MQIS P7_coupling';
        const result = getActionTargetVoltageLevels(detail, actionId, makeNodeMap('MQIS P7'));
        expect(result).toEqual(['MQIS P7']);
    });

    it('extracts multiple VLs from combined ID with spaces', () => {
        const detail = {
            description_unitaire: 'No description available',
            action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {}, pst_tap: {} }
        };

        const actionId = 'id1_MQIS P7_coupling+id2_SAUCAP7_coupling';
        const result = getActionTargetVoltageLevels(detail, actionId, makeNodeMap('MQIS P7', 'SAUCAP7'));
        expect(result).toContain('MQIS P7');
        expect(result).toContain('SAUCAP7');
    });
});
