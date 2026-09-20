package sre.commander.remediation

default allow = false

# Allow-list of safe, typed operational actions (PRD §12 & §13)
valid_actions := {
    "rollback_deployment",
    "restart_pod",
    "scale_workload",
    "cordon_node",
    "traffic_drain",
    "feature_flag_disable"
}

# Rule 1: Allow LOW risk in non-production automatically
allow {
    input.risk == "LOW"
    input.environment != "production"
    valid_actions[input.action]
}

# Rule 2: Allow HIGH risk ONLY with explicit human approval signature
allow {
    valid_actions[input.action]
    input.status == "APPROVED"
    input.approvedBy != ""
    count(input.idempotencyKey) > 10
}

# Denial reasons
deny[msg] {
    not valid_actions[input.action]
    msg := sprintf("Action '%v' is not permitted by SRE safety policy allow-list.", [input.action])
}

deny[msg] {
    input.environment == "production"
    input.risk == "HIGH"
    input.status != "APPROVED"
    msg := "Production HIGH-risk remediation requires explicit human approval before execution."
}
