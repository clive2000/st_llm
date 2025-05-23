import { eventSource, event_types, callPopup, getRequestHeaders, online_status, saveSettingsDebounced, settings } from '../script.js';
import { textgen_types, textgenerationwebui_settings, getTextGenServer } from '../scripts/textgen-settings.js';
import { SmoothEventSourceStream } from '../scripts/sse-stream.js';

// Used for settings
const tempaltesFolderPath = 'scripts/templates/';

const defaultSettings = {
    max_seq_len: 4096,
    cache_size: 'Max Seq Len',
    max_batch_size: 'Auto',
    fasttensors: false,
    rope_scale: 'Auto',
    rope_alpha: 'Auto',
    gpu_split_auto: true,
    gpu_split_value: null,
    cache_mode: 'FP16',
    draft_rope_alpha: 'Auto',
    draft_rope_scale: 'Auto',
    urlOverride: null,
    useProxy: false,
};

let tabbyModelLoadParams = defaultSettings;

// Cached models list
let models = [];
let draftModels = [];

const cache_mode = {
    FP16: 0,
    Q4: 1,
    Q6: 2,
    Q8: 3,
};

function getKeyByValue(object, value) {
    return Object.keys(object).find(key => object[key] === value);
}

// Check if user is connected to TabbyAPI
function verifyTabby(logError = true) {
    const result = online_status !== 'no_connection' || textgenerationwebui_settings.type === textgen_types.TABBY;
    if (!result && logError) {
        toastr.error('TabbyLoader: Please connect to a TabbyAPI instance to use this extension');
    }
    return result;
}

// Fetch the model list for autocomplete population
export async function fetchTabbyModels() {
    console.debug('fetchTabbyModels loaded');
    if (!verifyTabby(false)) {
        console.error('TabbyLoader: Could not connect to TabbyAPI');
        return;
    }

    var modelsFromResponse = [];

    try {
        let url = '/api/backends/text-completions/status';
        const response = await fetch(url, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                api_server: getTextGenServer('tabby'),
                api_type: 'tabby',
            }),
        });

        if (response.ok) {
            modelsFromResponse = await response.json();
        } else {
            console.error(`Mode list request failed with a statuscode of ${response.status}:\n${response.statusText}`);
            return [];
        }

        modelsFromResponse = modelsFromResponse.data.map((e) => e.id);

        console.debug(modelsFromResponse);

        models = modelsFromResponse;
        console.debug(models);

        $('#tabby_load_model_list')
            .autocomplete({
                source: (_, response) => {
                    return response(models);
                },
                minLength: 0,
            })
            .focus(function () {
                $(this)
                    .autocomplete(
                        'search',
                        String($(this).val()),
                    );
            });

    } catch (error) {
        console.error(error);

        return [];
    }
}

// This function is called when the button is clicked
export async function onTabbyLoadModelClick() {
    if (!verifyTabby()) {
        return;
    }

    const modelValue = $('#tabby_load_model_list').val();
    const draftModelValue = $('#tabby_load_draft_model_list').val();

    if (!modelValue || !models.includes(modelValue)) {
        console.debug(models);
        console.debug(modelValue);
        toastr.error('TabbyLoader: Please make sure the model name is spelled correctly before loading!');

        return;
    }

    if (draftModelValue !== '' && !draftModels.includes(draftModelValue)) {
        toastr.error('TabbyLoader: Please make sure the draft model name is spelled correctly before loading!');
        return;
    }

    const body = {
        name: modelValue,
        max_seq_len: Number(textgenerationwebui_settings?.tabbyModelLoadParams?.maxSeqLen) || 0,
        cache_size: Number(textgenerationwebui_settings?.tabbyModelLoadParams?.cacheSize) || null,
        max_batch_size: Number(textgenerationwebui_settings?.tabbyModelLoadParams?.maxBatchSize) || null,
        rope_scale: Number(textgenerationwebui_settings?.tabbyModelLoadParams?.ropeScale) || null,
        rope_alpha: Number(textgenerationwebui_settings?.tabbyModelLoadParams?.ropeAlpha) || null,
        gpu_split_auto: textgenerationwebui_settings?.tabbyModelLoadParams?.gpuSplitAuto,
        cache_mode: textgenerationwebui_settings?.tabbyModelLoadParams?.cacheMode,
        fasttensors: textgenerationwebui_settings?.tabbyModelLoadParams?.fasttensors,
    };

    if (draftModelValue) {
        body.draft = {
            draft_model_name: draftModelValue,
            draft_rope_scale: Number(textgenerationwebui_settings?.tabbyModelLoadParams?.draft.draft_ropeAlpha) || null,
            draft_rope_alpha: Number(textgenerationwebui_settings?.tabbyModelLoadParams?.draft.draft_ropeScale) || null,
        };
    }

    if (!body.gpu_split_auto) {
        // TODO: Add a check for an empty array here
        const gpuSplit = textgenerationwebui_settings?.tabbyModelLoadParams?.gpuSplit;

        if (Array.isArray(gpuSplit) && gpuSplit?.length > 0) {
            body['gpu_split'] = gpuSplit;
        } else {
            console.error(`TabbyLoader: GPU split ${gpuSplit} is invalid. Set to auto or adjust your parameters!`);
            toastr.error('TabbyLoader: Invalid GPU split. Set GPU split to auto or adjust your parameters');

            return;
        }
    }

    try {
        let url = '/api/backends/text-completions/tabby/load';
        const response = await fetch(url, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                api_server: getTextGenServer('tabby'),
                api_type: 'tabby',
                toTabby: JSON.stringify(body),
            }),
        });

        // Initialize progress bar only if not already initialized
        if (!$('#loading_progressbar').hasClass('ui-progressbar')) {
            $('#loading_progressbar').progressbar({
                value: 0,
                max: 100,
            });
        } else {
            $('#loading_progressbar').progressbar('value', 0); // Reset if already initialized
            console.debug('Progressbar already initialized, resetting value');
        }

        // Ensure single .ui-progressbar-value and initial state
        const progressValue = $('#loading_progressbar .ui-progressbar-value');
        if (progressValue.length > 1) {
            console.warn('Multiple .ui-progressbar-value elements detected:', progressValue.length);
            progressValue.slice(1).remove(); // Keep only the first
        }
        progressValue.css({
            display: 'none',
            width: '0%',
        });

        async function readStream(reader, progressContainer, soFar, times) {
            const { value, done } = await reader.read();
            if (done && soFar === times) {
                progressContainer.css('display', 'none');
                $('#loading_progressbar').progressbar('value', 0);
                progressValue.css({ display: 'none', width: '0%' });
                return;
            }

            if (!value) {
                console.warn('Empty stream value received');
                requestAnimationFrame(() => readStream(reader, progressContainer, soFar, times));
                return;
            }

            let packet;
            try {
                packet = JSON.parse(value.data);
            } catch (error) {
                console.error('Failed to parse stream packet:', error, value);
                requestAnimationFrame(() => readStream(reader, progressContainer, soFar, times));
                return;
            }

            if (packet.error) {
                progressContainer.css('display', 'none');
                $('#loading_progressbar').progressbar('value', 0);
                progressValue.css({ display: 'none', width: '0%' });
                throw new Error(packet.error.message);
            }

            const numerator = parseInt(packet.module) ?? 0;
            const denominator = parseInt(packet.modules) ?? 0;
            const percent = denominator ? (numerator / denominator) * 100 : 0;

            // Indicate draft or main model
            const modelLabel = soFar === 0 && times === 2 ? 'Draft Model' : 'Main Model';
            $('#loading_progress_container').attr('data-model', modelLabel);

            if (packet.status === 'finished') {
                if (soFar === times - 1) {
                    progressContainer.css('display', 'none');
                    toastr.info(`TabbyLoader: ${modelLabel} loaded`);
                    $('#loading_progressbar').progressbar('value', 0);
                    progressValue.css({ display: 'none', width: '0%' });
                } else {
                    $('#loading_progressbar').progressbar('value', 0);
                    progressValue.css({ display: 'none', width: '0%' });
                    toastr.info('TabbyLoader: Draft Model loaded');
                }
                soFar++;
            } else {
                const roundedPercent = Math.round(percent);
                $('#loading_progressbar').progressbar('value', roundedPercent);
                progressValue.css({
                    display: 'block',
                    width: `${roundedPercent}%`,
                });
            }

            requestAnimationFrame(() => readStream(reader, progressContainer, soFar, times));
        }

        if (response.ok) {
            if (!response.body) {
                console.error('No response body received');
                toastr.error('TabbyLoader: No stream received from server.');
                return;
            }

            const eventStream = new SmoothEventSourceStream();
            const reader = response.body.pipeThrough(eventStream).getReader();
            const progressContainer = $('#loading_progress_container');
            // Show container only during streaming
            progressContainer.css({
                display: 'block',
                visibility: 'visible',
                position: 'relative',
                zIndex: 1000,
            });
            let soFar = 0;
            let times = draftModelValue ? 2 : 1;
            await readStream(reader, progressContainer, soFar, times);
        } else {
            const responseJson = await response.json();
            console.error('TabbyLoader: Could not load the model because:', responseJson?.detail ?? response.statusText);
            toastr.error('TabbyLoader: Could not load the model. Please check the JavaScript or TabbyAPI console for details.');
        }
    } catch (error) {
        console.error('TabbyLoader: Could not load the model because:', error);
        toastr.error('Could not load the model. Please check the TabbyAPI console for details.');
    } finally {
        $('#loading_progressbar').progressbar('value', 0);
        $('#loading_progressbar .ui-progressbar-value').css({ display: 'none', width: '0%' });
    }
}

export async function onTabbyUnloadModelClick() {

    let url = '/api/backends/text-completions/tabby/unload';
    const response = await fetch(url, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            api_server: getTextGenServer('tabby'),
            api_type: 'tabby',
        }),
    });

    if (response.ok) {
        toastr.info('Tabby model was unloaded.');
    } else {
        const responseJson = await response.json();
        console.error('TabbyLoader: Could not unload the model because:\n', responseJson?.detail ?? response.statusText);
        toastr.error('TabbyLoader: Could not unload the model. Please check the browser or TabbyAPI console for details.');
        return [];
    }
}

export async function onTabbyParameterEditorClick() {
    console.debug('onParameterEditorClick');
    const parameterHtml = $(await $.get(`${tempaltesFolderPath}/tabbyModelParameters.html`));
    parameterHtml
        .find('input[name="max_seq_len"]')
        .val(textgenerationwebui_settings?.tabbyModelLoadParams?.maxSeqLen ?? 4096);
    parameterHtml
        .find('input[name="cache_size"]')
        .val(textgenerationwebui_settings?.tabbyModelLoadParams?.cacheSize ?? 'Max Seq Len');
    parameterHtml
        .find('input[name="max_batch_size"]')
        .val(textgenerationwebui_settings?.tabbyModelLoadParams?.maxBatchSize ?? 'Auto');
    parameterHtml
        .find('input[name="fasttensors"]')
        .prop('checked', textgenerationwebui_settings?.tabbyModelLoadParams?.fasttensors ?? false);
    parameterHtml
        .find('select[name="cache_mode_select"]')
        .val(cache_mode[textgenerationwebui_settings?.tabbyModelLoadParams?.cacheMode ?? 'FP16']);

    // Rope and Draft rope
    parameterHtml
        .find('input[name="rope_scale"]')
        .val(textgenerationwebui_settings?.tabbyModelLoadParams?.ropeScale ?? 'Auto');
    parameterHtml
        .find('input[name="rope_alpha"]')
        .val(textgenerationwebui_settings?.tabbyModelLoadParams?.ropeAlpha ?? 'Auto');
    parameterHtml
        .find('input[name="draft_rope_scale"]')
        .val(textgenerationwebui_settings?.tabbyModelLoadParams?.draft_ropeScale ?? 'Auto');
    parameterHtml
        .find('input[name="draft_rope_alpha"]')
        .val(textgenerationwebui_settings?.tabbyModelLoadParams?.draft_ropeAlpha ?? 'Auto');

    // MARK: GPU split options
    const gpuSplitAuto = textgenerationwebui_settings?.tabbyModelLoadParams?.gpuSplitAuto ?? true;

    const gpuSplitValue = textgenerationwebui_settings?.tabbyModelLoadParams?.gpuSplit;
    const gpuSplitTextbox = parameterHtml
        .find('input[name="gpu_split_value"]')
        .val(JSON.stringify(gpuSplitValue?.length > 0 ? gpuSplitValue : undefined))
        .prop('disabled', gpuSplitAuto);

    parameterHtml
        .find('input[name="gpu_split_auto"]')
        .prop('checked', gpuSplitAuto)
        .on('click', function () {
            gpuSplitTextbox.prop('disabled', $(this).prop('checked'));
        });

    const popupResult = await callPopup(parameterHtml, 'confirm', undefined, { okButton: 'Save' });
    if (popupResult) {
        const newParams = {
            maxSeqLen: Number(parameterHtml.find('input[name="max_seq_len"]').val()) || 4096,
            cacheSize: Number(parameterHtml.find('input[name="cache_mode"]').val()) || null,
            maxBatchSize: Number(parameterHtml.find('input[name="max_batch_size"]').val()) || null,
            ropeScale: Number(parameterHtml.find('input[name="rope_scale"]').val()) || null,
            ropeAlpha: Number(parameterHtml.find('input[name="rope_alpha"]').val()) || null,
            draft_ropeScale: Number(parameterHtml.find('input[name="draft_rope_scale"]').val()) || null,
            draft_ropeAlpha: Number(parameterHtml.find('input[name="draft_rope_alpha"]').val()) || null,
            gpuSplitAuto: parameterHtml.find('input[name="gpu_split_auto"]').prop('checked'),
            fasttensors: parameterHtml.find('input[name="fasttensors"]').prop('checked'),
            cacheMode: getKeyByValue(
                cache_mode,
                Number(
                    parameterHtml.find('select[name="cache_mode_select"]').find(':selected').val(),
                ) || 0,
            ),
        };

        // Handle GPU split setting
        const gpuSplitVal = String(parameterHtml.find('input[name="gpu_split_value"]').val());
        try {
            if (gpuSplitVal) {
                const gpuSplitArray = JSON.parse(gpuSplitVal) ?? [];
                if (Array.isArray(gpuSplitArray)) {
                    newParams['gpuSplit'] = gpuSplitArray;
                } else {
                    console.error(`Provided GPU split value (${gpuSplitArray}) is not an array.`);
                    newParams['gpuSplit'] = [];
                }
            }
        } catch (error) {
            console.error(error);
            newParams['gpuSplit'] = [];
        }
        textgenerationwebui_settings.tabbyModelLoadParams = newParams;

        saveSettingsDebounced();
    }
}

/* function migrateSettings() {
    let performSave = false;

    const modelParamsInSettings = settings?.textgenerationwebui_settings?.tabbyModelLoadParams?.modelParams;

    if (modelParamsInSettings && 'eightBitCache' in modelParamsInSettings) {
        const newParams = {
            cacheMode: settings.textgenerationwebui_settings?.tabbyModelLoadParams?.eightBitCache ? 'FP8' : 'FP16',
        };

        delete settings.textgenerationwebui_settings?.tabbyModelLoadParams.modelParams.eightBitCache;
        Object.assign(settings.textgenerationwebui_settings?.tabbyModelLoadParams?.modelParams, newParams);

        performSave = true;
    }

    if (performSave) {
        saveSettingsDebounced();
    }
} */

export async function loadTabbySettings() {
    if (!textgenerationwebui_settings.tabbyModelLoadParams) {
        console.warn('saw no tabby model loading object in text_gen settings');
        textgenerationwebui_settings.tabbyModelLoadParams = defaultSettings;
    }
    //Create the settings if they don't exist
    tabbyModelLoadParams = textgenerationwebui_settings?.tabbyModelLoadParams || {};

    if (Object.keys(tabbyModelLoadParams).length === 0) {
        console.warn('tabby model loading settings were empty in text_gen settings, using default instead.');
        Object.assign(tabbyModelLoadParams, defaultSettings);

    }

    saveSettingsDebounced();
    //migrateSettings();

    //$('#tabby_url_override').val(settings.textgenerationwebui_settings?.tabbyModelLoadParams?.urlOverride ?? '');
    //$('#tabby_use_proxy').prop('checked', settings.textgenerationwebui_settings?.tabbyModelLoadParams?.useProxy ?? false);

    // Updating settings in the UI
    //const placeholder = await getTabbyAuth() ? '✔️ Key found' : '❌ Missing key';
    //$('#tabby_admin_key').attr('placeholder', placeholder);
}



// This function is called when the extension is loaded
jQuery(async () => {

    /*     $('#tabby_load_draft_model_list')
            .autocomplete({
                source: (_, response) => {
                    return response(draftModels);
                },
                minLength: 0,
            })
            .focus(function () {
                $(this)
                    .autocomplete(
                        'search',
                        String($(this).val()),
                    );
            }); */

    $('#tabby_url_override').on('input', function () {
        const value = $(this).val();
        if (value !== undefined) {
            textgenerationwebui_settings.tabbyModelLoadParams.urlOverride = value;
            saveSettingsDebounced();
        }
    });

    $('#tabby_use_proxy').on('input', function () {
        textgenerationwebui_settings.tabbyModelLoadParams.useProxy = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#loading_progressbar').progressbar({
        value: 0,
    });

    $('#loading_progress_container').hide();

    // Load settings when starting things up (if you have any)
    eventSource.on(event_types.APP_READY, async () => {
        await loadTabbySettings();
    });

});
