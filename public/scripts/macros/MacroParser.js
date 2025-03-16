import { CstParser } from '../../lib/chevrotain.js';
import { MacroLexer } from './MacroLexer.js';

/** @typedef {import('../../lib/chevrotain.js').TokenType} TokenType */

/**
 * The singleton instance of the MacroParser.
 *
 * @type {MacroParser}
 */
let instance;
export { instance as MacroParser };

class MacroParser extends CstParser {
    /** @type {MacroParser} */ static #instance;
    /** @type {MacroParser} */ static get instance() { return MacroParser.#instance ?? (MacroParser.#instance = new MacroParser()); }

    /** @private */
    constructor() {
        super(MacroLexer.def, {
            traceInitPerf: true,
            nodeLocationTracking: 'full',
        });
        const Tokens = MacroLexer.tokens;

        const $ = this;

        // Basic Macro Structure
        $.macro = $.RULE('macro', () => {
            $.CONSUME(Tokens.Macro.Start);
            $.CONSUME(Tokens.Macro.Identifier);
            $.OPTION(() => $.SUBRULE($.arguments));
            $.CONSUME(Tokens.Macro.End);
        });

        // Arguments Parsing
        $.arguments = $.RULE('arguments', () => {
            // Remember the separator being used, it needs to stay consistent
            /** @type {import('../../lib/chevrotain.js').IToken} */
            let separator;
            $.OR([
                { ALT: () => separator = $.CONSUME(Tokens.Args.DoubleColon, { LABEL: 'separator' }) },
                { ALT: () => separator = $.CONSUME(Tokens.Args.Colon, { LABEL: 'separator' }) },
            ]);
            $.AT_LEAST_ONE_SEP({
                SEP: separator.tokenType,
                DEF: () => $.SUBRULE($.argument),
            });
        });

        $.argument = $.RULE('argument', () => {
            $.MANY(() => {
                $.OR([
                    { ALT: () => $.SUBRULE($.macro) }, // Nested Macros
                    { ALT: () => $.CONSUME(Tokens.Identifier) },
                    { ALT: () => $.CONSUME(Tokens.Unknown) },
                ]);
            });
        });

        this.performSelfAnalysis();
    }

    test(input) {
        const lexingResult = MacroLexer.tokenize(input);
        // "input" is a setter which will reset the parser's state.
        this.input = lexingResult.tokens;
        const cst = this.macro();

        // For testing purposes we need to actually persist the error messages in the object,
        // otherwise the test cases cannot read those, as they don't have access to the exception object type.
        const errors = this.errors.map(x => ({ message: x.message, ...x, stack: x.stack }));

        return { cst, errors: errors };
    }
}

instance = MacroParser.instance;
