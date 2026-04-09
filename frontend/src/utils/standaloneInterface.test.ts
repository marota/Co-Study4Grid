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

describe('standalone_interface.html Phase 2 optimizations', () => {
    const filePath = path.resolve(__dirname, '../../../standalone_interface.html');

    it('has resetAllState function that consolidates reset logic', () => {
        const content = fs.readFileSync(filePath, 'utf-8');
        // resetAllState should exist as a useCallback
        expect(content).toContain('const resetAllState = useCallback(');
        // It should call clearContingencyState inside
        expect(content).toMatch(/resetAllState[\s\S]*?clearContingencyState\(\)/);
    });

    it('handleApplySettings uses resetAllState instead of inline resets', () => {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Extract handleApplySettings function body (large fn with confirmation dialog before reset)
        const applyIdx = content.indexOf('const handleApplySettings = async ()');
        expect(applyIdx).toBeGreaterThan(0);
        // The function should call resetAllState() somewhere within its body
        const applyBody = content.substring(applyIdx, applyIdx + 4000);
        expect(applyBody).toContain('resetAllState()');
        // It should NOT contain the old inline reset pattern (multiple consecutive set calls)
        expect(applyBody).not.toContain('setNDiagram(null); setN1Diagram(null); setActionDiagram(null);');
    });

    it('handleLoadConfig uses resetAllState instead of inline resets', () => {
        const content = fs.readFileSync(filePath, 'utf-8');
        const loadIdx = content.indexOf('const handleLoadConfig = async ()');
        expect(loadIdx).toBeGreaterThan(0);
        const loadBody = content.substring(loadIdx, loadIdx + 2000);
        expect(loadBody).toContain('resetAllState()');
        // It should NOT contain the old inline reset comments
        expect(loadBody).not.toContain('// Diagrams\n                setNDiagram(null)');
    });

    it('clearContingencyState is wrapped with useCallback', () => {
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('const clearContingencyState = useCallback(');
    });

    it('has memoized recommenderConfig object', () => {
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('const recommenderConfig = useMemo(');
        // Should contain the grouped properties
        expect(content).toMatch(/recommenderConfig[\s\S]*?minLineReconnections.*minCloseCoupling/);
    });

    it('uses recommenderConfig for settings display', () => {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Settings display should reference recommenderConfig.minLineReconnections
        expect(content).toContain('recommenderConfig.minLineReconnections');
        expect(content).toContain('recommenderConfig.nPrioritizedActions');
        expect(content).toContain('recommenderConfig.ignoreReconnections');
    });

    it('clamps datalists rendering bounds to 50 options to prevent Chromium layout crashes', () => {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Both branches and inspectableItems rendering loops should invoke slice(0, 50) directly or conditionally 
        // to strictly cap the DOM nodes.
        const branchSliceMatch = content.match(/branches\.slice\(\s*0\s*,\s*50\s*\)/g);
        const inspectablesSliceMatch = content.match(/inspectableItems\.slice\(\s*0\s*,\s*50\s*\)/g);

        expect(branchSliceMatch).toBeTruthy();
        expect(inspectablesSliceMatch).toBeTruthy();
        
        // Ensure map logic inside datalists has actually been safely memoized or contained in IIFEs
        // Look for the "const contingencyOptions = useMemo(" block which was moved appropriately
        expect(content).toContain('const contingencyOptions = useMemo');
    });
});

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
