function defaultTieBreaker(left, right) {
    return left.model.localeCompare(right.model);
}
export function rankModels(models, scoreFn, options = {}) {
    const excluded = new Set(options.excludeModels ?? []);
    const tieBreaker = options.tieBreaker ?? defaultTieBreaker;
    return models
        .filter((model) => !excluded.has(model.model))
        .map((candidate) => ({
        candidate,
        score: scoreFn(candidate),
    }))
        .sort((left, right) => {
        if (left.score !== right.score)
            return right.score - left.score;
        return tieBreaker(left.candidate, right.candidate);
    });
}
export function pickBestModel(models, scoreFn, options = {}) {
    return rankModels(models, scoreFn, options)[0]?.candidate ?? null;
}
export function pickPrimaryAndSupport(models, scoring, preferredPrimaryModel) {
    if (models.length === 0)
        return { primary: null, support: null };
    const preferredPrimary = preferredPrimaryModel
        ? models.find((candidate) => candidate.model === preferredPrimaryModel)
        : undefined;
    const primary = preferredPrimary ?? pickBestModel(models, scoring.primary);
    if (!primary)
        return { primary: null, support: null };
    const support = pickBestModel(models, scoring.support, {
        excludeModels: [primary.model],
    }) ?? pickBestModel(models, scoring.support);
    return { primary, support };
}
