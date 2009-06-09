# Wrapper for a CGI script.

# Takes 3 arguments.

# First argument: name of environment-variable-setting script
envs=$1;
echo "Get envs from $envs"
if [ -f "$envs" ]
then
  . $envs
fi

#Second and third arguments: name of CGI script and name of output file.
script=$2;
output=$3;

echo "Executing $script > $output"
$script > $output

