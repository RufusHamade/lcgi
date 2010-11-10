# Wrapper for a CGI script.

# Takes 2 arguments.
script=$1;
output=$2;

#set > /tmp/jk
#echo "Executing $script > $output" >> /tmp/jk
$script > $output
#echo $? >> /tmp/jk
