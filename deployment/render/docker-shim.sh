#!/bin/sh
set -e
if [ "$1" = "exec" ]; then
  shift
  WORKDIR=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -i|-t|-it|-ti|--interactive|--tty)
        shift
        ;;
      --user|-u)
        shift 2
        ;;
      --user=*|-u=*)
        shift
        ;;
      --workdir|-w)
        WORKDIR="$2"
        shift 2
        ;;
      --workdir=*|-w=*)
        WORKDIR="${1#*=}"
        shift
        ;;
      -*)
        shift
        ;;
      *)
        shift
        break
        ;;
    esac
  done
  if [ -n "$WORKDIR" ]; then
    mkdir -p "$WORKDIR"
    chmod 700 "$WORKDIR" 2>/dev/null || true
    cd "$WORKDIR"
  fi
  exec "$@"
fi
echo "Unsupported docker command: $*" >&2
exit 1
