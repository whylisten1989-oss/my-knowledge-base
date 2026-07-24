(function exposeCustomerBITheme(global) {
    'use strict';

    const STORAGE_KEY = 'customer-bi-theme';
    const THEME_EVENT = 'customer-bi:theme-change';
    const charts = new Set();
    const originalOptions = new WeakMap();

    const chartPalettes = Object.freeze({
        dark: Object.freeze({
            series: ['#38bdf8', '#18bd8b', '#f6a918', '#8b5cf6'],
            tooltipBackground: '#13223a',
            tooltipBorder: '#2d4565',
            tooltipText: '#eaf4ff',
            legendText: '#7e93ad',
            axisText: '#6d829c',
            axisLine: '#2a3c57',
            splitLine: 'rgba(134,158,187,.12)',
            labelText: '#dcecff',
            secondaryLabel: '#8ca3c0',
            markLine: 'rgba(255,255,255,.28)',
            highlightBorder: '#ffffff'
        }),
        light: Object.freeze({
            series: ['#1677ff', '#0ca678', '#e59a14', '#7c3aed'],
            tooltipBackground: 'rgba(255,255,255,.98)',
            tooltipBorder: '#cbd9e8',
            tooltipText: '#24415f',
            legendText: '#61758a',
            axisText: '#71869a',
            axisLine: '#cad7e4',
            splitLine: 'rgba(93,119,148,.14)',
            labelText: '#294760',
            secondaryLabel: '#7a8ea3',
            markLine: 'rgba(45,73,103,.28)',
            highlightBorder: '#ffffff'
        })
    });

    const cloneOption = (value, seen = new WeakMap()) => {
        if (value === null || typeof value !== 'object') return value;
        if (seen.has(value)) return seen.get(value);

        const result = Array.isArray(value) ? [] : {};
        seen.set(value, result);

        Reflect.ownKeys(value).forEach((key) => {
            result[key] = cloneOption(value[key], seen);
        });

        return result;
    };

    const toArray = (value) => {
        if (value == null) return [];
        return Array.isArray(value) ? value : [value];
    };

    const currentTheme = () =>
        document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

    const themeChartOption = (sourceOption, theme = currentTheme()) => {
        const option = cloneOption(sourceOption);
        const palette = chartPalettes[theme];

        option.color = palette.series;

        if (option.tooltip) {
            option.tooltip.backgroundColor = palette.tooltipBackground;
            option.tooltip.borderColor = palette.tooltipBorder;
            option.tooltip.textStyle = {
                ...(option.tooltip.textStyle || {}),
                color: palette.tooltipText
            };
        }

        if (option.legend) {
            toArray(option.legend).forEach((legend) => {
                legend.textStyle = {
                    ...(legend.textStyle || {}),
                    color: palette.legendText
                };
            });
        }

        const themeAxis = (axis) => {
            toArray(axis).forEach((item) => {
                item.axisLine = item.axisLine || {};
                item.axisLine.lineStyle = {
                    ...(item.axisLine.lineStyle || {}),
                    color: palette.axisLine
                };
                item.axisLabel = {
                    ...(item.axisLabel || {}),
                    color: palette.axisText
                };
                item.splitLine = item.splitLine || {};
                if (item.splitLine.show !== false) {
                    item.splitLine.lineStyle = {
                        ...(item.splitLine.lineStyle || {}),
                        color: palette.splitLine
                    };
                }
            });
        };

        themeAxis(option.xAxis);
        themeAxis(option.yAxis);

        toArray(option.series).forEach((series) => {
            if (series.label) {
                series.label = {
                    ...series.label,
                    color: series.label.color
                        ? palette.labelText
                        : palette.labelText
                };
            }

            if (series.markLine) {
                series.markLine.label = {
                    ...(series.markLine.label || {}),
                    color: palette.labelText
                };
                series.markLine.lineStyle = {
                    ...(series.markLine.lineStyle || {}),
                    color: palette.markLine
                };
            }

            if (Array.isArray(series.data)) {
                series.data = series.data.map((item) => {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
                    const next = cloneOption(item);
                    if (next.itemStyle?.borderColor) {
                        next.itemStyle = {
                            ...next.itemStyle,
                            borderColor: palette.highlightBorder
                        };
                    }
                    return next;
                });
            }
        });

        return option;
    };

    const wrapChart = (chart) => {
        if (!chart || chart.__customerBIThemeWrapped) return chart;

        const nativeSetOption = chart.setOption.bind(chart);
        chart.__customerBIThemeWrapped = true;
        chart.__customerBIThemeNativeSetOption = nativeSetOption;

        chart.setOption = (option, ...rest) => {
            originalOptions.set(chart, cloneOption(option));
            return nativeSetOption(themeChartOption(option), ...rest);
        };

        const nativeDispose = chart.dispose.bind(chart);
        chart.dispose = (...args) => {
            charts.delete(chart);
            originalOptions.delete(chart);
            return nativeDispose(...args);
        };

        charts.add(chart);
        return chart;
    };

    const patchECharts = () => {
        if (!global.echarts || global.echarts.__customerBIThemePatched) return;

        const nativeInit = global.echarts.init.bind(global.echarts);
        const nativeGetInstanceByDom = global.echarts.getInstanceByDom.bind(global.echarts);

        global.echarts.init = (...args) => wrapChart(nativeInit(...args));
        global.echarts.getInstanceByDom = (...args) => wrapChart(nativeGetInstanceByDom(...args));
        global.echarts.__customerBIThemePatched = true;
    };

    const refreshCharts = () => {
        charts.forEach((chart) => {
            if (!chart || chart.isDisposed?.()) return;
            const option = originalOptions.get(chart);
            if (!option) return;
            chart.__customerBIThemeNativeSetOption(themeChartOption(option), true);
            chart.resize?.();
        });
    };

    const updateToggleAccessibility = () => {
        const theme = currentTheme();
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            const targetLabel = theme === 'dark' ? '切换到日间模式' : '切换到夜间模式';
            button.setAttribute('aria-label', targetLabel);
            button.setAttribute('title', targetLabel);
        });
    };

    const persistTheme = (theme) => {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (error) {
            console.warn('[Customer BI Theme] 无法写入 localStorage', error);
        }
    };

    const applyTheme = (theme, { persist = true, notify = true } = {}) => {
        const normalized = theme === 'light' ? 'light' : 'dark';
        document.documentElement.dataset.theme = normalized;

        if (persist) persistTheme(normalized);
        updateToggleAccessibility();
        refreshCharts();

        if (notify) {
            global.dispatchEvent(new CustomEvent(THEME_EVENT, {
                detail: { theme: normalized }
            }));
        }

        return normalized;
    };

    const toggleTheme = () =>
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');

    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-theme-toggle]');
        if (!button) return;
        toggleTheme();
    });

    patchECharts();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateToggleAccessibility, { once: true });
    } else {
        updateToggleAccessibility();
    }

    global.CustomerBITheme = Object.freeze({
        STORAGE_KEY,
        THEME_EVENT,
        getTheme: currentTheme,
        applyTheme,
        toggleTheme,
        chartPalette: () => chartPalettes[currentTheme()],
        refreshCharts
    });
})(window);